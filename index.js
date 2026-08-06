const express = require("express");
const axios = require("axios");
const cors = require("cors");
const moment = require("moment-timezone");
const cron = require("node-cron");
const cheerio = require("cheerio");
require("dotenv").config();

process.env.TZ = "Asia/Kathmandu";
moment.tz.setDefault("Asia/Kathmandu");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const OR_KEY = process.env.OPENROUTER_API_KEY;

let cache = { data: null, last_updated: null };

function getNepaliDateText() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];
  return {
    date_en: nepalNow.format('YYYY-MM-DD'),
    day: dayName
  };
}

// १. 'हाम्रो पात्रो' वा 'नेपाली पात्रो' बाट डाटा तान्ने
async function scrapeData() {
  try {
    console.log("🔍 'हाम्रो पात्रो' बाट डाटा तान्दै...");
    const { data } = await axios.get("https://www.hamropatro.com/rashifal", {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,ne;q=0.8"
      },
      timeout: 15000
    });
    const $ = cheerio.load(data);
    let scrapedText = "";
    $("p, div, span").each((i, el) => {
      scrapedText += $(el).text() + "\n";
    });
    if (scrapedText.length > 200) return scrapedText;
  } catch (err) {
    console.error("❌ 'हाम्रो पात्रो' स्क्र्यापिङ असफल:", err.message);
  }

  // ब्याकअप: नेपाली पात्रो
  try {
    console.log("⚠️ 'नेपाली पात्रो' (ब्याकअप) बाट डाटा तान्दै...");
    const { data } = await axios.get("https://nepalipatro.com.np/nepali-rashifal", {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      },
      timeout: 15000
    });
    const $ = cheerio.load(data);
    let scrapedText = "";
    $("p, div, span").each((i, el) => {
      scrapedText += $(el).text() + "\n";
    });
    return scrapedText;
  } catch (err) {
    console.error("❌ 'नेपाली पात्रो' स्क्र्यापिङ असफल:", err.message);
    return null;
  }
}

// २. तपाईंले भन्नु भएको दुई-चरण (Two-Step) प्रक्रिया: नेपाली -> अंग्रेजी अनुवाद -> सरल नेपालीमा ४ वाक्य जेनेरेट
async function processAndGenerate(rawContent, dateEn, dayName) {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return false;
  }

  const prompt = `You are an expert content writer and astrologer. 
Step 1: First, read the following raw scraped horoscope data from Nepal calendar and understand its core astrological meaning in English.
Step 2: Then, rewrite each of the 12 zodiac signs into **very simple, natural, and flowing conversational Nepali language**.

📌 Raw Data:
${rawContent ? rawContent.substring(0, 8000) : "Daily Horoscope"}

✅ Strict Rules for the Nepali Output:
1. **Each zodiac sign must have EXACTLY 4 sentences (not more, not less).**
2. Do not copy the original words directly; make it completely fresh, original, and easy to read.
3. Avoid heavy or complex Sanskrit words. Use everyday simple words.
4. Never include the zodiac sign's name inside the prediction text or at the beginning of sentences.
5. Do not start sentences with phrases like "आजको दिन" or "यस दिन".

Return ONLY a valid JSON object matching this exact structure:
{
  "date_np": "२०८३ साउन २१, बिहीबार",
  "date": "${dateEn}",
  "day": "${dayName}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्。"},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्।"},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्。"},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्。"},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "पहिलो वाक्य यहाँ लेख्नुहोस्। दोस्रो वाक्य लेख्नुहोस्। तेस्रो वाक्य लेख्नुहोस्। चौथो वाक्य लेख्नुहोस्。"}
  ]
}

⚡ CRITICAL: Do not include any extra markdown or text, only output valid JSON.`;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-20b:free",
        messages: [{ role: "user", content: prompt }]
      },
      { 
        headers: { 
          "Authorization": `Bearer ${OR_KEY.trim()}`,
          "HTTP-Referer": "https://render.com",
          "X-Title": "Rashifal App"
        },
        timeout: 45000 
      }
    );

    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    cache = { data: JSON.parse(cleanJson), last_updated: new Date().toISOString() };
    console.log("✅ Success! अंग्रेजी ट्रान्सलेसनमार्फत नयाँ राशिफल तयार भयो।");
    return true;
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.message);
    return false;
  }
}

// ३. मुख्य म्यानेजर फंक्सन
async function runWorkflow() {
  const { date_en, day } = getNepaliDateText();
  console.log(`🚀 ${date_en} (${day}) को लागि राशिफल वर्कफ्लो सुरु हुँदैछ...`);

  const rawData = await scrapeData();
  return await processAndGenerate(rawData, date_en, day);
}

cron.schedule('0 4 * * *', () => {
  runWorkflow();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

app.get("/api/rasifal", (req, res) => {
  if (!cache.data) {
    return res.status(503).json({ error: "Service Unavailable", message: "राशिफल अद्यावधिक हुँदैछ।" });
  }
  res.json(cache.data);
});

app.get("/api/generate-now", async (req, res) => {
  const success = await runWorkflow();
  if (success) {
    res.json({ status: "success", message: "सफलतापूर्वक जेनेरेट भयो!", data: cache.data });
  } else {
    res.status(500).json({ status: "error", message: "जेनेरेट गर्न असफल भयो।" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!cache.data) {
    await runWorkflow();
  }
});
