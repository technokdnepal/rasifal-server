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

if (!process.env.GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY missing");
}

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
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 15000
  });
  const $ = cheerio.load(res.data);
  return $(".date").first().text().trim();
}

/* ================= EN SOURCE ================= */
async function fetchEnglishText() {
  const res = await axios.get("https://english.hamropatro.com/rashifal", {
    headers: { "User-Agent": "Mozilla/5.0" },
    timeout: 15000
  });
  const $ = cheerio.load(res.data);
  return $("body").text().replace(/\s+/g, " ").slice(0, 6000);
}

/* ================= AI ================= */
async function generate() {
  try {
    const date_np = await fetchNepaliDate();
    if (cache.date_np === date_np) return;

    const sourceText = await fetchEnglishText();

    const prompt = `
Write DAILY horoscope in SIMPLE professional English.

RULES:
- EXACT 5 sentences per sign
- Soft predictive tone
- NO lucky info inside prediction
- Lucky color & number separate

Return JSON only.

SOURCE:
${sourceText}
`;

    const ai = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.55
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
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
  } catch (err) {
    console.error("❌ Generate failed:", err.message);
  }
}

/* ================= API ================= */
app.get("/api/rasifal", async (_, res) => {
  await generate();
  res.json(cache);
});

app.get("/api/rasifal/health", (_, res) => {
  res.json({ status: "OK" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
