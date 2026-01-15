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

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-8b-instant";

let cache = {
  date_np: null,
  source: null,
  generated_at: null,
  last_checked: null,
  data: []
};

/* ================= NEPALI DATE ================= */
async function fetchNepaliDate() {
  const res = await axios.get("https://hamropatro.com/rashifal", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const $ = cheerio.load(res.data);
  return $(".date").first().text().trim();
}

/* ================= EN SOURCE ================= */
async function fetchEnglishText() {
  const res = await axios.get("https://english.hamropatro.com/rashifal", {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  const $ = cheerio.load(res.data);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text;
}

/* ================= AI ================= */
async function generate() {
  const date_np = await fetchNepaliDate();
  if (cache.date_np === date_np) return;

  const sourceText = await fetchEnglishText();

  const prompt = `
You are a professional Vedic astrologer.

Write DAILY horoscope in SIMPLE ENGLISH.
Tone must be SOFT and PROBABILISTIC like Nepali astrology.

STRICT RULES:
- EXACTLY 5 sentences per sign
- Prediction ONLY (no lucky info inside)
- Use words like: may, seems, likely
- No guarantees
- Lucky color & number must be separate fields

Return ONLY JSON:

{
 "data":[
  {
   "sign":"Aries",
   "prediction":"5 sentences...",
   "lucky_color":"Red",
   "lucky_number":5
  }
 ]
}

SOURCE:
${sourceText}
`;

  const ai = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.55
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  const parsed = JSON.parse(ai.data.choices[0].message.content);

  cache = {
    date_np,
    source: "Groq AI (Hamro Patro EN)",
    generated_at: new Date().toISOString(),
    last_checked: new Date().toLocaleString("en-US", {
      timeZone: "Asia/Kathmandu"
    }),
    data: parsed.data
  };
}

/* ================= API ================= */
app.get("/api/rasifal", async (_, res) => {
  await generate();
  res.json(cache);
});

app.get("/api/rasifal/force-update", async (_, res) => {
  await generate();
  res.json({ success: true, date_np: cache.date_np });
});

app.listen(PORT, () => {
  console.log("Server running");
});
