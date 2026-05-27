const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const cors = require("cors");
const moment = require("moment-timezone");
require("dotenv").config();

// ✅ Force Nepal timezone
process.env.TZ = "Asia/Kathmandu";
moment.tz.setDefault("Asia/Kathmandu");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b:free"; // तपाईंले भन्नुभएको मोडल

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
  { en: "Cancer", np: "कर्कट" },
  { en: "Leo", np: "सिंह" },
  { en: "Virgo", np: "कन्या" },
  { en: "Libra", np: "तुला" },
  { en: "Scorpio", np: "वृश्चिक" },
  { en: "Sagittarius", np: "धनु" },
  { en: "Capricorn", np: "मकर" },
  { en: "Aquarius", np: "कुम्भ" },
  { en: "Pisces", np: "मीन" }
];

// ... (getNepalDateTime र extractNepaliDateNumber र fetchHamroPatroNepali फंक्सनहरू यथावत छन्) ...

async function generateRasifal() {
  const source = await fetchHamroPatroNepali();
  if (!source) {
    console.log("⚠️ Scraping failed, keeping existing cache");
    return false;
  }

  const { dateAD, dayName } = getNepalDateTime();
  const dateKey = source.date_np;

  // प्रम्प्ट अपडेट गरियो
  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज ${dateKey} ${dayName} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 महत्वपूर्ण सन्दर्भ:
- नेपाली ज्योतिष परम्परा अनुसार आजको ग्रह गोचर, तिथि र नक्षत्र अनुसार भविष्यवाणी गर्नुहोस्
- हाम्रो पात्रो, कान्तिपुर, BBC नेपाली जस्ता नेपाली साइटहरूको राशिफल शैली प्रयोग गर्नुहोस्
- दैनिक जीवनमा लागू हुने व्यावहारिक सल्लाह दिनुहोस्

✅ कडा नियमहरू:
1. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र!
2. स्वाभाविक, प्रवाहपूर्ण नेपाली भाषा प्रयोग गर्नुहोस्।
3. कुनै अङ्ग्रेजी शब्द प्रयोग नगर्नुहोस्।
4. राशिको नाम prediction भित्र नलेख्नुहोस्।
5. विश्वासयोग्य र सकारात्मक सन्देश दिनुहोस्।

⚠️ विविधता अनिवार्य: प्रत्येक राशिको सुरुवात फरक तरिकाले गर्नुहोस्।

📝 लेखन शैली:
- पहिलो वाक्य: आजको मुख्य प्रवृत्ति।
- दोस्रो वाक्य: करियर/शिक्षा सम्बन्धित।
- तेस्रो वाक्य: आर्थिक/सम्बन्ध सम्बन्धित।
- चौथो वाक्य: सावधानी/सल्लाह।

JSON Format (केवल यो मात्र):
{
  "date": "${dateKey}",
  "day": "${dayName}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "चार वाक्य..."},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "चार वाक्य..."},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "चार वाक्य..."},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "चार वाक्य..."},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "चार वाक्य..."},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "चार वाक्य..."},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "चार वाक्य..."},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "चार वाक्य..."},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "चार वाक्य..."},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "चार वाक्य..."},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "चार वाक्य..."},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "चार वाक्य..."}
  ]
}

⚡ CRITICAL: केवल valid JSON return गर्नुहोस्। Extra text, markdown, explanation केही पनि नदिनुहोस्।`;

  try {
    const aiRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        response_format: { type: "json_object" }
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const content = aiRes.data.choices[0].message.content;
    const parsed = JSON.parse(content);

    cache = {
      date_np: source.date_np,
      source: "Groq AI (Nepali Astrologer)",
      generated_at: new Date().toISOString(),
      last_checked: new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" }),
      data: parsed.data
    };

    console.log(`✅ SUCCESS! Updated to ${source.date_np}`);
    return true;
  } catch (err) {
    console.error("❌ AI Error:", err.message);
    return false;
  }
}

// ... (बाँकी क्रोन जॉब्स र एप इन्डपोइन्टहरू उस्तै छन्) ...
