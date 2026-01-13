const express = require("express");
const axios = require("axios");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-8b-instant";
const DATA_FILE = "./rasifal.json";

/* ---------- Utils ---------- */

const RASHI_MAP = {
  Aries: "मेष",
  Taurus: "वृष",
  Gemini: "मिथुन",
  Cancer: "कर्कट",
  Leo: "सिंह",
  Virgo: "कन्या",
  Libra: "तुला",
  Scorpio: "वृश्चिक",
  Sagittarius: "धनु",
  Capricorn: "मकर",
  Aquarius: "कुम्भ",
  Pisces: "मीन"
};

function isToday(data) {
  if (!data?.generatedAt) return false;
  return data.generatedAt.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function containsRoman(text) {
  return /[a-zA-Z]/.test(text);
}

/* ---------- Groq Call ---------- */

async function groq(messages) {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: GROQ_MODEL,
      messages,
      temperature: 0.2
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

/* ---------- Generator ---------- */

async function generateRasifal() {
  console.log("🧠 Generating English base...");

  const english = await groq([
    {
तिमी एक नेपाली ज्योतिष लेखक हौ।

काम:
आजको १२ राशिको दैनिक राशिफल लेख।

महत्वपूर्ण नियम:
1. भाषा Hamro Patro र Nepali Patro जस्तै हुनुपर्छ
2. वाक्य छोटा र सरल हुनुपर्छ
3. कुनै पनि आदेशात्मक शब्द प्रयोग नगर्नु
   (जस्तै: गर्नुहोस्, तयार रहनुहोस्, प्रयास गर्नुहोस् ❌)
4. अनुमानात्मक शैली प्रयोग गर्नु:
   - हुन सक्छ
   - देखिन्छ
   - मिल्नेछ
   - रहनेछ
5. दोहोरिने शब्द प्रयोग नगर्नु
6. अत्यधिक गह्रौँ संस्कृत शब्द प्रयोग नगर्नु
7. सबै वाक्य शुद्ध देवनागरी नेपालीमा हुनुपर्छ
8. राशिको नामपछि ":" प्रयोग गर्नु (मेष: ...)
9. प्रत्येक राशिमा 1–2 वाक्य मात्र

Source style reference:
- Hamro Patro
- Nepali Patro

नोट:
तिमीले तिनको शब्द copy गर्नु हुँदैन,
तर लेख्ने शैली, भाषा र भाव मिल्नुपर्छ।

Output format (JSON मात्र):
{
  "data": [
    { "sign": "मेष", "prediction": "..." }
  ]
}
`
    }
  ]);

  const eng = JSON.parse(english);

  console.log("🇳🇵 Rewriting into PURE Nepali...");

  const nepaliRaw = await groq([
    {
      role: "user",
      content: `
Rewrite the following horoscope into PURE, SHUDDHA NEPALI.

STRICT RULES:
- Use ONLY Devanagari (नेपाली अक्षर)
- NO Roman letters
- NO Hindi/Urdu words (par, tum, achha, garnu, etc.)
- Simple Nepali everyone understands
- Newspaper horoscope style
- Short sentences
- If Roman letter appears, response is INVALID

Return SAME JSON structure only.

JSON:
${JSON.stringify(eng)}
`
    }
  ]);

  const nep = JSON.parse(nepaliRaw);

  // Validation
  nep.data.forEach(r => {
    if (containsRoman(r.prediction)) {
      throw new Error("Roman text detected, retry needed");
    }
  });

  const finalData = {
    generatedAt: new Date().toISOString(),
    source: "GROQ_STRICT_NEPALI",
    data: nep.data.map(r => ({
      sign: RASHI_MAP[r.sign] || r.sign,
      prediction: r.prediction
    }))
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(finalData, null, 2));
  console.log("✅ Clean Nepali rasifal saved");

  return finalData;
}

/* ---------- API ---------- */

app.get("/api/rasifal", async (req, res) => {
  try {
    let data = fs.existsSync(DATA_FILE)
      ? JSON.parse(fs.readFileSync(DATA_FILE))
      : null;

    if (!isToday(data)) {
      data = await generateRasifal();
    }

    res.json({ status: "SUCCESS", ...data });

  } catch (e) {
    console.error("❌ Error:", e.message);
    res.json({
      status: "ERROR",
      message: "राशिफल तयार गर्न सकिएन"
    });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
