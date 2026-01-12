const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama3-8b-8192";

// Safe static backup (never fails)
const backupRasifal = [
  { sign: "मेष", prediction: "आज आत्मविश्वास बढ्नेछ। नयाँ काम सुरु गर्न राम्रो दिन हो।" },
  { sign: "वृष", prediction: "धन र परिवार पक्ष बलियो रहनेछ। संयमित व्यवहार लाभदायक हुनेछ।" },
  { sign: "मिथुन", prediction: "सम्पर्क र कुराकानीबाट फाइदा हुनेछ। रोकिएका काम बन्नेछन्।" },
  { sign: "कर्कट", prediction: "स्वास्थ्यमा ध्यान दिनुहोस्। अनावश्यक तनावबाट टाढा रहनुहोस्।" },
  { sign: "सिंह", prediction: "मान-सम्मान बढ्ने दिन छ। नेतृत्वदायी काममा सफलता मिल्नेछ।" },
  { sign: "कन्या", prediction: "धैर्य र योजना अनुसार काम गर्दा राम्रो नतिजा मिल्नेछ।" },
  { sign: "तुला", prediction: "आर्थिक पक्ष मजबुत हुनेछ। नयाँ अवसरहरू देखिनेछन्।" },
  { sign: "वृश्चिक", prediction: "निर्णय सोचेर लिनुहोला। भावनामा बग्न नदिनुहोस्।" },
  { sign: "धनु", prediction: "यात्रा र अध्ययनमा लाभ मिल्ने संकेत छ।" },
  { sign: "मकर", prediction: "पुराना कामहरू पूरा हुनेछन्। जिम्मेवारी बढ्न सक्छ।" },
  { sign: "कुम्भ", prediction: "नयाँ योजना सफल हुने संकेत छ। मित्र सहयोग मिल्नेछ।" },
  { sign: "मीन", prediction: "मानसिक शान्ति मिल्नेछ। धार्मिक वा सकारात्मक काममा मन जानेछ।" }
];

app.get('/api/rasifal', async (req, res) => {
  try {
    console.log(`🤖 Groq AI (${GROQ_MODEL}) call गर्दै...`);

    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [
          {
            role: "user",
            content:
              "आजको १२ राशिको दैनिक राशिफल सरल र सकारात्मक नेपालीमा लेख्नुहोस्। " +
              "प्रत्येक राशिको नाम (मेष, वृष...) र १–२ लाइन भविष्यवाणी दिनुहोस्।"
          }
        ],
        temperature: 0.7,
        max_tokens: 600
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );

    const text = response.data.choices[0].message.content;

    // Simple text → structured format
    const signs = [
      "मेष","वृष","मिथुन","कर्कट","सिंह","कन्या",
      "तुला","वृश्चिक","धनु","मकर","कुम्भ","मीन"
    ];

    let result = [];
    signs.forEach(sign => {
      const regex = new RegExp(`${sign}[\\s:-]*(.*)`);
      const match = text.match(regex);
      if (match) {
        result.push({ sign, prediction: match[1].trim() });
      }
    });

    if (result.length < 12) throw new Error("Incomplete AI data");

    res.json({
      status: "SUCCESS",
      source: "GROQ_AI",
      updatedAt: new Date().toISOString().split("T")[0],
      data: result
    });

  } catch (e) {
    console.error("⚠️ AI Failed! Using Static Backup:", e.message);
    res.json({
      status: "SUCCESS",
      source: "STATIC_BACKUP_SAFE_MODE",
      updatedAt: new Date().toISOString().split("T")[0],
      data: backupRasifal
    });
  }
});

app.get('/', (_, res) => res.send("Rasifal Server Online ✅"));

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
