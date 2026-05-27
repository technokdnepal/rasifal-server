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
  date_np: null,
  source: null,
  generated_at: null,
  last_checked: null,
  data: []
};

function getNepalDateTime() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dayNames = {
    'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार',
    'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार'
  };
  return { dateAD: nepalNow.format('YYYY-MM-DD'), dayName: dayNames[nepalNow.format('dddd')] };
}

function extractNepaliDateNumber(dateText) {
  const match = dateText.match(/[०-९]+/);
  return match ? match[0] : null;
}

async function fetchHamroPatroNepali() {
  try {
    const res = await axios.get("https://www.hamropatro.com/rashifal", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000
    });
    const $ = cheerio.load(res.data);
    let date_np = $(".articleTitle.fullWidth h2").first().text().replace("आज -", "").trim();
    if (!date_np) date_np = $(".date").first().text().replace("आज -", "").trim();
    
    return { date_np };
  } catch (err) {
    console.error("❌ Scraping Error:", err.message);
    return null;
  }
}

async function generateRasifal() {
  const source = await fetchHamroPatroNepali();
  if (!source) return false;

  const { dayName } = getNepalDateTime();
  const dateKey = source.date_np;

  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज ${dateKey} ${dayName} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

कडा नियमहरू:
१. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस्।
२. पूर्णतः स्वाभाविक नेपाली भाषा प्रयोग गर्नुहोस्, कुनै अङ्ग्रेजी शब्द नमिसाउनुहोस्।
३. राशिको नाम prediction भित्र नलेख्नुहोस्।
४. सुरुमा राशिको नाम नभनी सिधै मुख्य विषयबाट सुरु गर्नुहोस्।
५. कुनै पनि lucky_color वा lucky_number नदिनुहोस्।

JSON ढाँचामा मात्र उत्तर दिनुहोस्:
{
  "date": "${dateKey}",
  "day": "${dayName}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "चार वाक्यको राशिफल..."},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "चार वाक्यको राशिफल..."}
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
      {
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }
      }
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

cron.schedule("0 6 * * *", generateRasifal, { timezone: "Asia/Kathmandu" });

app.get("/api/rasifal", (req, res) => res.json(cache));
app.get("/api/rasifal/force-update", async (req, res) => {
  const ok = await generateRasifal();
  res.json({ success: ok, date: cache.date_np });
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await generateRasifal();
});
