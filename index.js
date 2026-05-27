const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const cors = require("cors");
const moment = require("moment-timezone");
require("dotenv").config();

process.env.TZ = "Asia/Kathmandu";
moment.tz.setDefault("Asia/Kathmandu");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b:free";

let cache = {
  date_np: "डेटा अपडेट हुँदैछ...",
  source: "Initializing...",
  generated_at: new Date().toISOString(),
  data: []
};

// बलियो हेडरको साथ स्क्र्यापिङ
async function fetchHamroPatroNepali() {
  try {
    const res = await axios.get("https://www.hamropatro.com/rashifal", {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,ne;q=0.8"
      },
      timeout: 30000
    });
    const $ = cheerio.load(res.data);
    const date_text = $(".articleTitle.fullWidth h2").text().trim() || "आजको राशिफल";
    return { date_np: date_text };
  } catch (err) {
    console.error("❌ Scraping Error:", err.message);
    return null;
  }
}

async function generateRasifal() {
  const source = await fetchHamroPatroNepali();
  const dateKey = source ? source.date_np : "आज";

  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज ${dateKey} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।
नियमहरू: १. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र। २. पूर्णतः स्वाभाविक नेपाली भाषा। ३. राशिको नाम Prediction भित्र नलेख्नुहोस्। ४. सल्लाह र सकारात्मक सन्देश। ५. JSON मा मात्र उत्तर दिनुहोस्।

JSON ढाँचा:
{
  "date": "${dateKey}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "..."},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "..."},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "..."},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "..."},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "..."},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "..."},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "..."},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "..."},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "..."},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "..."},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "..."},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "..."}
  ]
}`;

  try {
    const aiRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        response_format: { type: "json_object" }
      },
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } }
    );

    const parsed = JSON.parse(aiRes.data.choices[0].message.content);
    cache = {
      date_np: dateKey,
      source: "Groq AI (Nepali Astrologer)",
      generated_at: new Date().toISOString(),
      data: parsed.data
    };
    return true;
  } catch (err) {
    console.error("❌ AI Error:", err.message);
    return false;
  }
}

app.get("/api/rasifal", (req, res) => res.json(cache));
app.get("/api/rasifal/force-update", async (req, res) => {
  await generateRasifal();
  res.json(cache);
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await generateRasifal();
});
