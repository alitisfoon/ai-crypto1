const $ = (id) => document.getElementById(id);
let candles = [];
let lastPrice = null;
let marketSnapshot = null;

function fmt(value, digits=4) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {maximumFractionDigits:digits}).format(value);
}
function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let result = values.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i=period; i<values.length; i++) result = values[i]*k + result*(1-k);
  return result;
}
function rsi(values, period=14) {
  if (values.length <= period) return null;
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];if(d>=0)gains+=d;else losses-=d;}
  let avgGain=gains/period, avgLoss=losses/period;
  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1];
    avgGain=(avgGain*(period-1)+Math.max(d,0))/period;
    avgLoss=(avgLoss*(period-1)+Math.max(-d,0))/period;
  }
  if(avgLoss===0) return 100;
  return 100-(100/(1+avgGain/avgLoss));
}
async function getJSON(url){
  const res=await fetch(url);
  if(!res.ok) throw new Error("دریافت اطلاعات بازار ناموفق بود.");
  return res.json();
}
async function loadData(){
  $("errorBox").hidden=true;
  $("chartStatus").textContent="در حال دریافت";
  const interval=$("intervalSelect").value;
  try{
    const data=await getJSON(`/api/market?interval=${encodeURIComponent(interval)}`);
    lastPrice=Number(data.price);
    candles=data.candles;
    marketSnapshot=data;
    const change=Number(data.change24h);
    $("tonPrice").textContent=fmt(lastPrice,5)+" USDT";
    $("tonChange").textContent=`تغییر ۲۴ ساعته: ${change>=0?"+":""}${fmt(change,2)}٪`;
    $("tonChange").className="change "+(change>=0?"positive":"negative");
    analyzeIndicators();
    drawChart();
    $("updatedAt").textContent="آخرین به‌روزرسانی: "+new Date().toLocaleTimeString("fa-IR");
    $("chartStatus").textContent="داده دریافت شد";
  }catch(err){
    $("chartStatus").textContent="خطا در دریافت";
    $("errorBox").textContent=err.message+" اتصال اینترنت یا دسترسی به سرویس بازار را بررسی کن.";
    $("errorBox").hidden=false;
  }
}
function analyzeIndicators(){
  const closes=candles.map(c=>Number(c.close));
  const fast=ema(closes,9), slow=ema(closes,21), rv=rsi(closes,14);
  $("emaFast").textContent=fmt(fast,5);
  $("emaSlow").textContent=fmt(slow,5);
  $("rsiValue").textContent=rv===null?"—":fmt(rv,1);
  $("rsiText").textContent=rv===null?"داده کافی نیست":rv<30?"احتمال اشباع فروش":rv>70?"احتمال اشباع خرید":"محدوده میانی";
  const box=$("signalBox");
  let signal="صبر", desc="برای تصمیم‌گیری، تحلیل هوش مصنوعی را هم اجرا کن.", cls="neutral", icon="⏸";
  if(fast!==null && slow!==null && rv!==null){
    if(fast>slow && rv>=40 && rv<70){signal="تمایل تکنیکال به خرید";desc="EMA کوتاه بالاتر از EMA بلند است؛ این فقط یک نشانه تکنیکال است.";cls="buy";icon="↗";}
    else if(fast<slow && rv>30 && rv<=60){signal="تمایل تکنیکال به فروش";desc="EMA کوتاه پایین‌تر از EMA بلند است؛ این فقط یک نشانه تکنیکال است.";cls="sell";icon="↘";}
  }
  box.className="signal-box "+cls;
  $("signalIcon").textContent=icon;
  $("signalTitle").textContent=signal;
  $("signalDesc").textContent=desc;
  $("stopLoss").textContent=lastPrice?fmt(lastPrice*0.97,5)+" USDT":"—";
  $("takeProfit").textContent=lastPrice?fmt(lastPrice*1.05,5)+" USDT":"—";
}
function drawChart(){
  const canvas=$("priceChart"), rect=canvas.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
  const width=Math.max(300,rect.width), height=260;
  canvas.width=width*dpr;canvas.height=height*dpr;
  const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,width,height);
  if(!candles.length)return;
  const vals=candles.map(c=>Number(c.close)), min=Math.min(...vals), max=Math.max(...vals), pad=18;
  const range=(max-min)||1;
  ctx.strokeStyle="#26364e";ctx.lineWidth=1;
  for(let i=0;i<5;i++){const y=pad+i*(height-2*pad)/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
  ctx.beginPath();
  vals.forEach((v,i)=>{const x=i*(width/(vals.length-1));const y=height-pad-((v-min)/range)*(height-2*pad);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});
  ctx.strokeStyle="#43d5c5";ctx.lineWidth=2.2;ctx.stroke();
  const grad=ctx.createLinearGradient(0,pad,0,height);grad.addColorStop(0,"rgba(67,213,197,.22)");grad.addColorStop(1,"rgba(67,213,197,0)");
  const lastY=height-pad-((vals[vals.length-1]-min)/range)*(height-2*pad);
  ctx.lineTo(width,lastY);ctx.lineTo(width,height-pad);ctx.lineTo(0,height-pad);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
}
async function runAIAnalysis(){
  const btn=$("aiAnalyzeBtn");
  if(!marketSnapshot){$("aiStatus").textContent="ابتدا باید داده بازار دریافت شود.";return;}
  btn.disabled=true;btn.textContent="هوش مصنوعی در حال تحلیل…";
  $("aiStatus").textContent="در حال ارسال داده‌های بازار برای تحلیل هوشمند؛ ممکن است چند ثانیه طول بکشد.";
  $("aiResult").textContent="لطفاً صبر کن…";
  try{
    const response=await fetch("/api/analyze",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({market:marketSnapshot, interval:$("intervalSelect").value})
    });
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||"تحلیل انجام نشد.");
    $("aiResult").textContent=result.analysis;
    $("aiStatus").textContent="تحلیل هوش مصنوعی دریافت شد · "+new Date().toLocaleTimeString("fa-IR");
  }catch(err){
    $("aiStatus").textContent="خطا در تحلیل";
    $("aiResult").textContent=err.message+" اگر کلید API تنظیم نشده، راهنمای README را ببین.";
  }finally{btn.disabled=false;btn.textContent="تحلیل دوباره با هوش مصنوعی";}
}
$("refreshBtn").addEventListener("click",loadData);
$("intervalSelect").addEventListener("change",loadData);
$("aiAnalyzeBtn").addEventListener("click",runAIAnalysis);
window.addEventListener("resize",drawChart);
loadData();
setInterval(loadData,60000);
