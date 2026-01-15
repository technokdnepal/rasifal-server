const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const cors = require("cors");
require("dotenv").config();

process.env.TZ = "Asia/Kathmandu";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-8b-instant";

let cache = {
  date_np: null,
  source: null,
  generated_at: null,
  last_checked: null,
  data: []
};

const SIGNS = [
  { en: "Aries", np: "मेष" },
  { en: "Taurus", np: "वृष" },
  { en: "Gemini", np: "मिथुन" },
  { en: "Cancer", np: "कर्क" },
  { en: "Leo", np: "सिंह" },
  { en: "Virgo", np: "कन्या" },
  { en: "Libra", np: "तुला" },
  { en: "Scorpio", np: "वृश्चिक" },
  { en: "Sagittarius", np: "धनु" },
  { en: "Capricorn", np: "मकर" },
  { en: "Aquarius", np: "कुम्भ" },
  { en: "Pisces", np: "मीन" }
];

async function fetchHamroPatroNepali() {
  const res = await axios.get("https://www.hamropatro.com/rashifal", {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 20000
  });

  const $ = cheerio.load(res.data);

  const date_np = $(".date").first().text().replace("आज -", "").trim();

  let text = $("body").text().replace(/\s+/g, " ").trim();

  if (!date_np || text.length < 1000) return null;

  return { date_np, text };
}

async function generateRasifal() {
  const source = await fetchHamroPatroNepali();
  if (!source) return false;

  if (cache.date_np === source.date_np) return true;

  const prompt = `
You are a professional Vedic astrologer.

Source content (Nepali, do NOT translate directly):
"""
${source.text.substring(0, 4000)}
"""

TASK:
Generate DAILY HOROSCOPE in PROFESSIONAL ENGLISH.

STRICT RULES:
1. EXACTLY 12 signs.
2. EXACTLY 5 sentences per sign.
3. Start directly. NO intro phrases.
4. DO NOT mention lucky color or number in prediction text.
5. Lucky color & number must be calculated by you (planetary logic), NOT copied.
6. Language must be clean professional English.
7. Scorpio Nepali name must be 'वृश्चिक'.
8. Output JSON only.

FORMAT:
{
 "data": [
  {
    "sign": "Aries",
    "sign_np": "मेष",
    "prediction": "Five professional English sentences.",
    "lucky_color": "Blue",
    "lucky_number": 4
  }
 ]
}
`;

  const aiRes = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      response_format: { type: "json_object" }
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const parsed = JSON.parse(aiRes.data.choices[0].message.content);

  cache = {
    date_np: source.date_np,
    source: "Groq AI (Hamro Patro)",
    generated_at: new Date().toISOString(),
    last_checked: new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" }),
    data: parsed.data
  };

  return true;
}

cron.schedule("*/15 0-10 * * *", async () => {
  cache.last_checked = new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" });
  await generateRasifal();
});

app.get("/api/rasifal", (req, res) => res.json(cache));

app.get("/api/rasifal/force-update", async (req, res) => {
  const ok = await generateRasifal();
  res.json({ success: ok });
});

app.listen(PORT, async () => {
  console.log(`🚀 Rasifal server running on ${PORT}`);
  await generateRasifal();
});
