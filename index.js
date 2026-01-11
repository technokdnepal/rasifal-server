const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   GEMINI SETUP
========================= */
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

/* =========================
   COMMON HEADERS (ANTI-403)
========================= */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Accept-Language": "ne-NP,ne;q=0.9,en-US;q=0.8,en;q=0.7",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
};

/* =========================
   MANUAL CLEANER (FAIL SAFE)
========================= */
function manualCleaner(text) {
  if (!text) return "";

  return text
    .replace(/\(.*?\)/g, "")
    .replace(/Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces/gi, "")
    .replace(/चु|चे|चो|ला|लि|लु|ले|लो/gi, "")
    .replace(/आजको शुभ रंग.*$/gi, "")
    .replace(/शुभ अंक.*$/gi, "")
    .replace(/[:\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================
   GEMINI CLEANER (OPTIONAL)
========================= */
async function cleanWithAI(sign, rawText) {
  if (!genAI) return manualCleaner(rawText);

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
    });

    const prompt = `
तपाईं एक प्रोफेशनल नेपाली सम्पादक हुनुहुन्छ।
'${sign}' राशिको तलको टेक्स्टलाई २–३ वाक्यमा
सरल, शुद्ध नेपाली भाषामा लेख्नुहोस्।
नाम, चु-चे-चो, शुभ रंग, शुभ अंक हटाउनुहोस्।
केवल राशिफल मात्र लेख्नुहोस्।

INPUT:
${rawText}
`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (e) {
    console.log("⚠️ Gemini failed, manual cleaner used");
    return manualCleaner(rawText);
  }
}

/* =========================
   SCRAPE: HAMRO PATRO
========================= */
async function fetchFromHamroPatro() {
  const url = "https://www.hamropatro.com/rashifal";
  const response = await axios.get(url, {
    headers: HEADERS,
    timeout: 20000,
  });

  const $ = cheerio.load(response.data);
  let data = [];

  $(".item").each((i, el) => {
    const sign = $(el).find("h3").text().trim();
    const text = $(el).find(".desc p").text().trim();
    if (sign && text.length > 30) {
      data.push({ sign, text });
    }
  });

  if (data.length < 6) throw new Error("Hamro Patro blocked / empty");
  return data;
}

/* =========================
   SCRAPE: EKANTIPUR (FALLBACK)
========================= */
async function fetchFromEkantipur() {
  const url = "https://ekantipur.com/horoscope";
  const response = await axios.get(url, {
    headers: HEADERS,
    timeout: 20000,
  });

  const $ = cheerio.load(response.data);
  let data = [];

  $(".item").each((i, el) => {
    const sign = $(el).find("h2,h3").first().text().trim();
    const text = $(el).find("p").text().trim();
    if (sign && text.length > 30) {
      data.push({ sign, text });
    }
  });

  if (data.length < 6) throw new Error("Ekantipur scrape failed");
  return data;
}

/* =========================
   API ROUTE
========================= */
app.get("/api/rasifal", async (req, res) => {
  try {
    console.log("🔍 Trying Hamro Patro...");
    let rawData;

    try {
      rawData = await fetchFromHamroPatro();
      console.log("✅ Hamro Patro success");
    } catch (e) {
      console.log("⚠️ Hamro Patro failed → Ekantipur");
      rawData = await fetchFromEkantipur();
    }

    let final = [];

    for (const item of rawData) {
      const cleaned = await cleanWithAI(item.sign, item.text);
      final.push({
        sign: item.sign,
        prediction: cleaned,
      });
    }

    res.json({
      status: "SUCCESS",
      source: "AUTO (HamroPatro → Ekantipur)",
      data: final,
    });
  } catch (e) {
    res.status(500).json({
      status: "ERROR",
      message: "राशिफल अपडेट गर्न सकिएन",
      detail: e.message,
    });
  }
});

/* =========================
   ROOT
========================= */
app.get("/", (req, res) => {
  res.send("✅ Rasifal Server Online");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
