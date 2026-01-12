/**
 * AI Rasifal Server
 * Stable + Fallback + Cache Enabled
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// =====================
// Gemini Setup (SAFE)
// =====================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY missing");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// =====================
// Cache (Daily)
// =====================
let rasifalCache = {
  date: "",
  data: null,
  source: ""
};

// =====================
// Helpers
// =====================
function todayKey() {
  return new Date().toISOString().split("T")[0];
}

// =====================
// Ekantipur Fallback
// =====================
async function fetchFromEkantipur() {
  console.log("📰 Fallback: Ekantipur बाट राशिफल तान्दै...");
  const url = "https://ekantipur.com/horoscope";

  const res = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  const $ = cheerio.load(res.data);
  let results = [];

  const signs = [
    "मेष","वृष","मिथुन","कर्कट","सिंह","कन्या",
    "तुला","वृश्चिक","धनु","मकर","कुम्भ","मीन"
  ];

  $('div').each((_, el) => {
    const text = $(el).text().trim();
    signs.forEach(sign => {
      if (text.startsWith(sign) && text.length > 40) {
        results.push({
          sign,
          prediction: text.replace(sign, '').trim()
        });
      }
    });
  });

  return results.slice(0, 12);
}

// =====================
// AI Generator
// =====================
async function generateWithAI() {
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  const prompt = `
तपाईं एक अनुभवी नेपाली ज्योतिषी हुनुहुन्छ।
आजको मिति ${todayKey()} को लागि १२ वटै राशिको दैनिक राशिफल लेख्नुहोस्।

Rules:
- भाषा: सरल, सकारात्मक नेपाली
- "चु, चे, चो" आदि नलेख्नुहोस्
- शुभ रंग / शुभ अंक नलेख्नुहोस्
- ठीक १२ वटा राशिहरू हुनुपर्छ
- Output ONLY valid JSON Array हुनुपर्छ

Format:
[
 {"sign":"मेष","prediction":"..."},
 ...
]
`;

  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI_TIMEOUT")), 15000)
    )
  ]);

  const text = result.response.text()
    .replace(/```json|```/g, '')
    .trim();

  return JSON.parse(text);
}

// =====================
// API Route
// =====================
app.get('/api/rasifal', async (req, res) => {
  try {
    const today = todayKey();

    // Serve cache
    if (rasifalCache.date === today && rasifalCache.data) {
      console.log("⚡ Cache hit");
      return res.json({
        status: "SUCCESS",
        source: rasifalCache.source,
        updatedAt: rasifalCache.date,
        data: rasifalCache.data
      });
    }

    console.log("🤖 Gemini AI बाट नयाँ राशिफल...");

    let data;
    let source = "GEMINI_AI";

    try {
      data = await generateWithAI();
    } catch (aiErr) {
      console.error("⚠️ AI Failed:", aiErr.message);
      data = await fetchFromEkantipur();
      source = "EKANTIPUR_FALLBACK";
    }

    if (!data || data.length < 12) {
      throw new Error("Incomplete Rasifal Data");
    }

    rasifalCache = {
      date: today,
      data,
      source
    };

    res.json({
      status: "SUCCESS",
      source,
      updatedAt: today,
      data
    });

  } catch (e) {
    console.error("❌ Final Error:", e.message);

    if (rasifalCache.data) {
      return res.json({
        status: "OFFLINE_SUCCESS",
        source: "LAST_CACHE",
        updatedAt: rasifalCache.date,
        data: rasifalCache.data
      });
    }

    res.status(500).json({
      status: "ERROR",
      message: "राशिफल अपडेट गर्न सकिएन"
    });
  }
});

// =====================
app.get('/', (_, res) =>
  res.send('✅ AI Rasifal Server is Online')
);

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
