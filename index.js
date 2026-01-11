const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

/* ===============================
   Gemini AI Setup (Future-proof)
================================ */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";

/* ===============================
   Simple Daily Cache
================================ */
let cache = {
  date: "",
  data: null
};

/* ===============================
   Manual Cleaner (Fail-Safe)
================================ */
function manualCleaner(raw) {
  return raw
    .replace(/^.*?\)\s*/, '')          // मेष (चु, चे...) हटाउने
    .replace(/Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces/gi, '')
    .replace(/BoManma/gi, '')
    .split("आजको शुभ रंग")[0]
    .split("शुभ अंक")[0]
    .trim();
}

/* ===============================
   Gemini Call (Single Sign)
================================ */
async function callGeminiForSingleSign(sign, rawPrediction) {
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `
तपाईं एक प्रोफेसनल नेपाली सम्पादक हुनुहुन्छ।
'${sign}' राशिको यो राशिफलबाट:
- सुरुको नाम र (चु, चे, चो...) हटाउनुहोस्
- "आजको शुभ रंग" र "शुभ अंक" हटाउनुहोस्
- केवल मुख्य अर्थ २–३ वाक्यमा सरल नेपालीमा लेख्नुहोस्
- कुनै heading, emoji वा explanation नदिनुहोस्

INPUT:
${rawPrediction}
`;

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("AI Timeout")), 8000)
      )
    ]);

    const text = result.response.text().trim();
    return text.length > 20 ? text : manualCleaner(rawPrediction);

  } catch (e) {
    console.log(`⚠️ AI failed for ${sign}, using manual cleaner`);
    return manualCleaner(rawPrediction);
  }
}

/* ===============================
   API Endpoint
================================ */
app.get('/api/rasifal', async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    /* ===== Cache hit ===== */
    if (cache.date === today && cache.data) {
      return res.json({
        status: "SUCCESS",
        cached: true,
        updatedAt: today,
        data: cache.data
      });
    }

    console.log("📡 Hamro Patro बाट राशिफल तान्दै...");

    const response = await axios.get(
      'https://www.hamropatro.com/rashifal',
      {
        timeout: 15000,
        headers: {
          "User-Agent": "Googlebot"
        }
      }
    );

    const $ = cheerio.load(response.data);
    let scrapedData = [];

    $('.item').each((i, el) => {
      const sign = $(el).find('h3').text().trim();
      const text = $(el).find('.desc p').text().trim();

      if (sign && text && text.length > 30) {
        scrapedData.push({ sign, text });
      }
    });

    if (scrapedData.length === 0) {
      throw new Error("No horoscope data scraped");
    }

    console.log("🤖 १२ राशिलाई AI बाट प्रोसेस गर्दै...");
    let finalResults = [];

    for (const item of scrapedData) {
      console.log(`➡ ${item.sign}`);
      const cleanPrediction =
        await callGeminiForSingleSign(item.sign, item.text);

      finalResults.push({
        sign: item.sign,
        prediction: cleanPrediction
      });
    }

    /* ===== Save Cache ===== */
    cache = {
      date: today,
      data: finalResults
    };

    res.json({
      status: "SUCCESS",
      cached: false,
      source: "hamropatro",
      ai: true,
      updatedAt: new Date().toISOString(),
      data: finalResults
    });

  } catch (e) {
    console.error("❌ Error:", e.message);

    res.status(500).json({
      status: "ERROR",
      message: "राशिफल अपडेट गर्न सकिएन",
      detail: e.message
    });
  }
});

/* ===============================
   Health Check
================================ */
app.get('/', (req, res) => {
  res.send('✅ Rasifal Server is Online & Stable');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
