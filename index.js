const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ ENV VARIABLES (Render मा यिनै नाम हुनुपर्छ)
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama3-70b-8192";

// 🔒 Static Backup (NEVER FAILS)
const backupRasifal = [
  {"sign":"मेष","prediction":"आज नयाँ कामको सुरुवातका लागि राम्रो समय छ।"},
  {"sign":"वृष","prediction":"धन र पारिवारिक पक्ष बलियो रहनेछ।"},
  {"sign":"मिथुन","prediction":"सञ्चार र सम्बन्धमा सफलता मिल्नेछ।"},
  {"sign":"कर्कट","prediction":"स्वास्थ्यमा ध्यान दिनु उपयुक्त हुन्छ।"},
  {"sign":"सिंह","prediction":"काममा प्रशंसा र मान सम्मान प्राप्त हुनेछ।"},
  {"sign":"कन्या","prediction":"धैर्य राख्दा राम्रो नतिजा मिल्नेछ।"},
  {"sign":"तुला","prediction":"आर्थिक पक्ष मजबुत हुनेछ।"},
  {"sign":"वृश्चिक","prediction":"निर्णय सोचेर लिनुहोस्।"},
  {"sign":"धनु","prediction":"यात्राको योग देखिन्छ।"},
  {"sign":"मकर","prediction":"पुराना कामहरू पूरा हुनेछन्।"},
  {"sign":"कुम्भ","prediction":"नयाँ अवसरहरू देखा पर्नेछन्।"},
  {"sign":"मीन","prediction":"मानसिक शान्ति मिल्नेछ।"}
];

// 🧠 JSON extractor (AI गल्ती गरे पनि काम गर्छ)
function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON not found");
  return JSON.parse(match[0]);
}

app.get('/api/rasifal', async (req, res) => {
  try {
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY missing");

    console.log("🤖 Groq AI बाट राशिफल मागिँदैछ...");

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a Nepali astrologer. Always reply in valid JSON only."
          },
          {
            role: "user",
            content: `
आजको १२ राशिको दैनिक राशिफल सरल र सकारात्मक नेपालीमा लेख।
अनिवार्य JSON मात्र फिर्ता गर, अरू टेक्स्ट नलेख।

FORMAT:
{
  "data": [
    {"sign":"मेष","prediction":"..."},
    {"sign":"वृष","prediction":"..."},
    ...
    {"sign":"मीन","prediction":"..."}
  ]
}
            `
          }
        ],
        temperature: 0.4
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const rawText = response.data.choices[0].message.content;
    const parsed = extractJSON(rawText);

    if (!parsed.data || parsed.data.length !== 12) {
      throw new Error("Invalid AI data");
    }

    res.json({
      status: "SUCCESS",
      source: "GROQ_AI",
      updatedAt: new Date().toISOString().split("T")[0],
      data: parsed.data
    });

  } catch (err) {
    console.error("⚠️ Groq Failed:", err.message);

    res.json({
      status: "SUCCESS",
      source: "STATIC_BACKUP_SAFE_MODE",
      updatedAt: new Date().toISOString().split("T")[0],
      data: backupRasifal
    });
  }
});

app.get("/", (req, res) => {
  res.send("AI Rasifal Server Running Smoothly 🚀");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
