const express = require("express");
const axios = require("axios");
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
  source: "AI Generated",
  generated_at: null,
  data: []
};

async function generateRasifal() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');
  const dayName = nepalNow.format('dddd'); // यहाँ नेपाली नाम राख्न तलको म्याप प्रयोग गर्न सकिन्छ

  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज मिति ${dateKey} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

कडा नियमहरू:
१. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस्।
२. पूर्णतः स्वाभाविक नेपाली भाषा प्रयोग गर्नुहोस्, कुनै अङ्ग्रेजी शब्द नमिसाउनुहोस्।
३. राशिको नाम prediction भित्र नलेख्नुहोस्।
४. सीधै राशिफलबाट सुरु गर्नुहोस्।
५. JSON ढाँचामा मात्र उत्तर दिनुहोस्।

JSON ढाँचा:
{
  "date": "${dateKey}",
  "day": "${dayName}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "४ वाक्यको राशिफल..."},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "४ वाक्यको राशिफल..."}
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
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } }
    );

    const parsed = JSON.parse(aiRes.data.choices[0].message.content);
    
    cache = {
      date_np: dateKey,
      source: "AI Generated (Vedic Astrologer)",
      generated_at: new Date().toISOString(),
      data: parsed.data
    };
    console.log("✅ राशिफल सफलतापूर्वक जेनेरेट भयो।");
    return true;
  } catch (err) {
    console.error("❌ AI Error:", err.message);
    return false;
  }
}

app.get("/api/rasifal", (req, res) => res.json(cache));

app.get("/api/rasifal/force-update", async (req, res) => {
  const success = await generateRasifal();
  res.json({ success, data: cache });
});

app.listen(PORT, async () => {
  console.log(`🚀 सर्भर पोर्ट ${PORT} मा चलिरहेको छ।`);
  await generateRasifal(); // स्टार्ट हुने बित्तिकै राशिफल बनाउँछ
});
