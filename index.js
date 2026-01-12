const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
// Render को पोर्ट १०००० सेट गरिएको छ
const PORT = process.env.PORT || 10000;

// ================= CONFIG =================
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

// Startup diagnostics - सर्भर चल्ने बित्तिकै सेटिङ चेक गर्न
console.log("🔑 GROQ_API_KEY present:", GROQ_API_KEY ? "YES" : "NO");
console.log("🧠 GROQ_MODEL:", GROQ_MODEL);

// ================= STATIC BACKUP =================
// एआई फेल भयो भने यो सुरक्षित डाटा एपमा जान्छ
const backupRasifal = [
  { "sign": "मेष", "prediction": "आज नयाँ कामको थालनी गर्ने राम्रो समय छ।" },
  { "sign": "वृष", "prediction": "धन र परिवारको क्षेत्रमा लाभ मिल्नेछ।" },
  { "sign": "मिथुन", "prediction": "रोकिएका कामहरू बन्नेछन्।" },
  { "sign": "कर्कट", "prediction": "स्वास्थ्यमा ध्यान दिनु उपयुक्त हुन्छ।" },
  { "sign": "सिंह", "prediction": "काममा प्रशंसा मिल्नेछ।" },
  { "sign": "कन्या", "prediction": "धैर्य राख्दा राम्रो नतिजा आउँछ।" },
  { "sign": "तुला", "prediction": "आर्थिक पक्ष मजबुत हुनेछ।" },
  { "sign": "वृश्चिक", "prediction": "निर्णय सोचेर लिनुहोस्।" },
  { "sign": "धनु", "prediction": "यात्राको योग देखिन्छ।" },
  { "sign": "मकर", "prediction": "पुराना काम पूरा हुनेछन्।" },
  { "sign": "कुम्भ", "prediction": "नयाँ अवसरहरू देखा पर्नेछन्।" },
  { "sign": "मीन", "prediction": "मानसिक शान्ति मिल्नेछ।" }
];

// ================= ROUTE =================
app.get('/api/rasifal', async (req, res) => {
  // यदि API Key छैन भने एआई कल नगरी सिधै ब्याकअप पठाउने
  if (!GROQ_API_KEY) {
    console.warn("⚠️ GROQ_API_KEY missing → Static fallback used");
    return res.json({
      status: "SUCCESS",
      source: "STATIC_NO_API_KEY",
      data: backupRasifal
    });
  }

  try {
    console.log(`🤖 Calling Groq AI (${GROQ_MODEL})...`);

    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: GROQ_MODEL,
        messages: [{
          role: "user",
          // तपाईँको नयाँ र परिमार्जित निर्देशन यहाँ छ
          content: "Write today's 12 zodiac horoscopes in simple and pure Nepali language. " +
                   "Avoid literal translations and don't use weird phrases. Use standard, natural Nepali sentences that a human astrologer would write. " +
                   "Ensure no Hindi words are used. Use correct names like 'कर्कट' and 'वृष'. " +
                   "The output MUST be valid JSON. " +
                   "Return a JSON object exactly in this format: " +
                   "{ \"data\": [ { \"sign\": \"मेष\", \"prediction\": \"...\" } ] }"
        }],
        response_format: { type: "json_object" }
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000 // १५ सेकेन्डको टाइमआउट
      }
    );

    const rawContent = response.data?.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error("Empty AI response content");
    }

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (jsonErr) {
      console.error("❌ JSON parse failed. Raw content:", rawContent);
      throw jsonErr;
    }

    return res.json({
      status: "SUCCESS",
      source: "GROQ_AI",
      updatedAt: new Date().toISOString().split('T')[0],
      data: parsed.data || parsed
    });

  } catch (e) {
    // एआई फेल भयो भने लग्समा कारण देखाउने र ब्याकअप डाटा पठाउने
    if (e.response && e.response.data) {
      console.error(
        "❌ Groq API Error Detail:",
        JSON.stringify(e.response.data, null, 2)
      );
    } else {
      console.error("⚠️ AI Request Failed:", e.message);
    }

    return res.json({
      status: "SUCCESS",
      source: "STATIC_BACKUP_SAFE_MODE",
      updatedAt: new Date().toISOString().split('T')[0],
      data: backupRasifal
    });
  }
});

// ================= ROOT =================
app.get('/', (req, res) => {
  res.send('✅ Rasifal Server is running (Stable Mode)');
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
