const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
require("dotenv").config();

process.env.TZ = "Asia/Kathmandu";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

/* ================= CONFIG ================= */
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

/* ================= CACHE ================= */
let rasifalCache = {
  date_np: null,
  source: null,
  generated_at: null,
  last_checked: null,
  data: []
};

/* ================= FETCH NEPALI DATE ================= */
async function fetchOfficialNepaliDate() {
  try {
    const res = await axios.get("https://hamropatro.com/rashifal", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 15000
    });

    const $ = cheerio.load(res.data);
    const dateText = $(".date").first().text().trim();

    if (!dateText) return null;
    return dateText; // "आज - ०१ माघ २०८२ बिहीबार"
  } catch {
    return null;
  }
}

/* ================= FETCH ENGLISH SOURCE ================= */
async function fetchEnglishSource() {
  try {
    const res = await axios.get("https://english.hamropatro.com/rashifal", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000
    });

    const $ = cheerio.load(res.data);
    const text = $(".desc-card, .item").text().replace(/\s+/g, " ").trim();

    if (text.length > 500) {
      return { text, site: "Hamro Patro (EN)" };
    }
  } catch {}

  try {
    const res = await axios.get("https://nepalipatro.com.np/en/nepali-rashifal", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000
    });

    const $ = cheerio.load(res.data);
    const text = $("body").text().replace(/\s+/g, " ").trim();
    return { text, site: "Nepali Patro (EN)" };
  } catch {
    return null;
  }
}

/* ================= AI PROCESS ================= */
async function generateRasifal() {
  const nepaliDate = await fetchOfficialNepaliDate();
  if (!nepaliDate) return false;

  if (rasifalCache.date_np === nepaliDate) {
    return true; // already generated today
  }

  const source = await fetchEnglishSource();
  if (!source) return false;

  const prompt = `
You are a professional Vedic astrologer.

Write today's 12 zodiac daily horoscopes in PROFESSIONAL SIMPLE ENGLISH.

STRICT RULES:
- Start sentences directly, no introductions
- EXACTLY 5 sentences per sign
- No lucky color or number inside prediction
- Calculate lucky color & number yourself
- Simple Indian-English tone
- No copied lines from source

Return ONLY JSON:

{
 "data": [
   {
     "sign": "Aries",
     "prediction": "5 sentences...",
     "lucky_color": "Red",
     "lucky_number": 5
   }
 ]
}

SOURCE TEXT:
${source.text}
`;

  try {
    const aiRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.6
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const parsed = JSON.parse(aiRes.data.choices[0].message.content);

    rasifalCache = {
      date_np: nepaliDate,
      source: `Groq AI (${source.site})`,
      generated_at: new Date().toISOString(),
      last_checked: new Date().toLocaleString("en-US", {
        timeZone: "Asia/Kathmandu"
      }),
      data: parsed.data || []
    };

    return true;
  } catch (e) {
    console.error("AI ERROR:", e.response?.data || e.message);
    return false;
  }
}

/* ================= ROUTES ================= */
app.get("/api/rasifal", async (req, res) => {
  if (!rasifalCache.date_np) {
    await generateRasifal();
  }
  res.json(rasifalCache);
});

app.get("/api/rasifal/force-update", async (req, res) => {
  const ok = await generateRasifal();
  res.json({ success: ok, date_np: rasifalCache.date_np });
});

/* ================= START ================= */
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await generateRasifal();
});
