import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-6-luna";
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "40kb" }));
app.use(express.static("public"));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }));

const BINANCE = "https://data-api.binance.vision";
async function binanceJSON(path) {
  const r = await fetch(BINANCE + path);
  if (!r.ok) throw new Error("سرویس داده بازار پاسخ مناسب نداد.");
  return r.json();
}
function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a,b)=>a+b,0)/period;
  for (let i=period; i<values.length; i++) e = values[i]*k + e*(1-k);
  return e;
}
function calcRSI(values, period=14) {
  if (values.length <= period) return null;
  let up=0, down=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1]; if(d>0)up+=d;else down-=d;}
  let ag=up/period, al=down/period;
  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1];
    ag=(ag*(period-1)+Math.max(d,0))/period;
    al=(al*(period-1)+Math.max(-d,0))/period;
  }
  return al===0 ? 100 : 100-(100/(1+ag/al));
}
app.get("/api/market", async (req,res) => {
  try {
    const allowed = new Set(["15m","1h","4h","1d"]);
    const interval = allowed.has(req.query.interval) ? req.query.interval : "1h";
    const [ticker, stats, raw] = await Promise.all([
      binanceJSON("/api/v3/ticker/price?symbol=TONUSDT"),
      binanceJSON("/api/v3/ticker/24hr?symbol=TONUSDT"),
      binanceJSON(`/api/v3/klines?symbol=TONUSDT&interval=${interval}&limit=100`)
    ]);
    const candles = raw.map(x=>({time:x[0],open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),volume:Number(x[5])}));
    const closes=candles.map(c=>c.close);
    const volumes=candles.map(c=>c.volume);
    res.json({
      symbol:"TONUSDT", price:Number(ticker.price), change24h:Number(stats.priceChangePercent),
      volume24h:Number(stats.volume), interval, candles,
      indicators:{ema9:calcEMA(closes,9),ema21:calcEMA(closes,21),rsi14:calcRSI(closes,14),
        averageVolume20:volumes.slice(-20).reduce((a,b)=>a+b,0)/Math.min(20,volumes.length)}
    });
  } catch (e) {
    res.status(502).json({error:e.message || "خطا در دریافت داده بازار"});
  }
});
app.post("/api/analyze", async (req,res) => {
  try {
    if (!openai) return res.status(503).json({error:"کلید OpenAI تنظیم نشده است. فایل .env را طبق README تکمیل کن."});
    const market = req.body?.market;
    if (!market || market.symbol !== "TONUSDT" || !Array.isArray(market.candles) || market.candles.length < 25) {
      return res.status(400).json({error:"داده بازار معتبر یا کافی نیست. ابتدا صفحه را به‌روزرسانی کن."});
    }
    // Only a compact, bounded slice of public market data is sent to the model.
    const compact = {
      symbol: market.symbol, price: market.price, change24h: market.change24h,
      volume24h: market.volume24h, interval: market.interval,
      indicators: market.indicators,
      recentCandles: market.candles.slice(-40).map(c=>({
        open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume
      }))
    };
    const prompt = `تو تحلیل‌گر آموزشی بازار رمزارز هستی. داده زیر اطلاعات عمومی بازار TON/USDT است.
فقط بر اساس همین داده‌ها تحلیل کن و هر جا داده کافی نیست صریح بگو. قیمت و اعداد را جعل نکن.
خروجی را فارسی، روشن و با این سرفصل‌ها بنویس:
۱) وضعیت فعلی بازار و روند احتمالی
۲) بررسی EMA9، EMA21، RSI14 و حجم
۳) سناریوی صعودی و نزولی و چه چیزی هر سناریو را باطل می‌کند
۴) نتیجه: «تمایل به خرید»، «تمایل به فروش» یا «صبر»؛ همراه دلیل
۵) ریسک‌ها و مواردی که باید پیش از تصمیم بررسی شوند.
اگر محدوده‌های حمایت/مقاومت یا حد ضرر را نمی‌توان از داده حاضر با اطمینان استخراج کرد، عدد نساز و بگو نیازمند بررسی بیشتر است.
هیچ سودی را تضمین نکن و به کاربر نگو حتماً بخرد یا بفروشد. این فقط تحلیل اطلاعات است، نه مشاوره مالی شخصی.
داده بازار (JSON):
${JSON.stringify(compact)}`;
    const response = await openai.responses.create({model:MODEL, input:prompt});
    const analysis = response.output_text?.trim();
    if (!analysis) throw new Error("مدل پاسخ متنی برنگرداند؛ دوباره تلاش کن.");
    res.json({analysis, model:MODEL});
  } catch (e) {
    console.error("AI analysis error:", e?.message || e);
    res.status(500).json({error:"تحلیل هوش مصنوعی ناموفق بود. تنظیمات API و اعتبار حساب را بررسی کن."});
  }
});
app.get("/api/health", (_req,res)=>res.json({ok:true,aiConfigured:Boolean(openai),model:MODEL}));
app.listen(PORT, "0.0.0.0", ()=>console.log(`AI Crypto dashboard running on http://localhost:${PORT}`));
