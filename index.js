const express = require("express");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
const DATA_FILE = "./rasifal.json";

/* ------------------ Utils ------------------ */

function isTodayGenerated(data) {
  if (!data || !data.generatedAt) return false;
  const today = new Date().toISOString().slice(0, 10);
  return data.generatedAt.startsWith(today);
}

function cleanNepali(text) {
  const map = {
    "नौले": "नयाँ",
    "पावल्यो": "पाएको छ",
    "उत्खनन": "अवसर",
    "रणनीतिको लागि": "रणनीतिका लागि",
    "मन:स्थिति": "मनस्थिति"
  };
  let out = text;
  for (const k in map) out = out.split(k).join(map[k]);
  return out;
}

/* ------------------ Groq Call ------------------ */

async function callGroq(messages) {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: GROQ_MODEL,
      messages,
      temperature: 0.3
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
  return res.data.choices[0].message.content;
}

/* ------------------ Generate Rasifal ------------------ */

async function generateDailyRasifal() {
  console.log("🤖 Generating English horoscope...");

  const english = await callGroq([
    {
      role: "user",
      content: `
Write today's 12 zodiac horoscopes in clear, neutral English.
Avoid clichés.
Each sign must have 2 short sentences.
Output ONLY valid JSON:
{
 "data":[{"sign":"Aries","prediction":"..."}]
}
`
    }
  ]);

  const engJSON = JSON.parse(english);

  console.log("🌐 Translating to Nepali...");

  const nepali = await callGroq([
    {
      role: "user",
      content: `
Translate the following horoscope into SIMPLE, SHUDDHA Nepali.

Rules:
- Use common Nepali words only
- No poetic or heavy Sanskrit words
- Newspaper-style horoscope
- Do not add meaning
- Short sentences
- Output same JSON structure

JSON:
${JSON.stringify(engJSON)}
`
    }
  ]);

  const nepJSON = JSON.parse(nepali);

  nepJSON.data = nepJSON.data.map(r => ({
    sign: r.sign,
    prediction: cleanNepali(r.prediction)
  }));

  const finalData = {
    generatedAt: new Date().toISOString(),
    source: "GROQ_ENGLISH_TO_NEPALI",
    data: nepJSON.data
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(finalData, null, 2));
  console.log("✅ Rasifal saved");

  return finalData;
}

/* ------------------ API ------------------ */

app.get("/api/rasifal", async (req, res) => {
  try {
    let data = null;

    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE));
    }

    if (!isTodayGenerated(data)) {
      data = await generateDailyRasifal();
    }

    res.json({
      status: "SUCCESS",
      ...data
    });

  } catch (e) {
    console.error("❌ Error:", e.message);
    res.json({
      status: "ERROR",
      message: "राशिफल अपडेट गर्न सकिएन"
    });
  }
});

/* ------------------ Server ------------------ */

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
