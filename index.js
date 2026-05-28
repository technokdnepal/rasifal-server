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

const OR_KEY = process.env.OPENROUTER_API_KEY;

let cache = { data: [], last_updated: null };

async function generateRasifal() {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return;
  }

  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];

  // तपाईंले दिनुभएको ओरिजिनल प्रम्प्ट यहाँ राखिएको छ
  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज ${dateKey} ${dayName} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 महत्वपूर्ण सन्दर्भ:
- नेपाली ज्योतिष परम्परा अनुसार आजको ग्रह गोचर, तिथि र नक्षत्र अनुसार भविष्यवाणी गर्नुहोस्
- हाम्रो पात्रो, कान्तिपुर, BBC नेपाली जस्ता नेपाली साइटहरूको राशिफल शैली प्रयोग गर्नुहोस्
- दैनिक जीवनमा लागू हुने व्यावहारिक सल्लाह दिनुहोस्

✅ कडा नियमहरू:
1. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र (धेरै होइन!)
2. स्वाभाविक, प्रवाहपूर्ण नेपाली भाषा (जस्तै: Hamro Patro, बीबीसी नेपाली)
3. कुनै अङ्ग्रेजी शब्द प्रयोग नगर्नुहोस्
4. राशिको नाम prediction भित्र नलेख्नुहोस्
5. विश्वासयोग्य र सकारात्मक सन्देश

⚠️ विविधता अनिवार्य: प्रत्येक राशिको सुरुवात फरक तरिकाले गर्नुहोस्!
- "आजको दिन", "आज तपाईँको", "आजको ऊर्जा" जस्ता दोहोरिने शब्दहरू नप्रयोग गर्नुहोस्
- सीधै मुख्य विषयबाट सुरु गर्नुहोस् (जस्तै: "आर्थिक लाभको योग रहेको...", "करियरमा नयाँ मोड...", "स्वास्थ्यमा थकान...", "सम्बन्धमा मिठास...")

📝 लेखन शैली:
- पहिलो वाक्य: आजको मुख्य प्रवृत्ति।
- दोस्रो वाक्य: करियर/शिक्षा सम्बन्धित।
- तेस्रो वाक्य: आर्थिक/सम्बन्ध सम्बन्धित।
- चौथो वाक्य: सावधानी/सल्लाह।

⚠️ नोट: lucky_color र lucky_number app ले generate गर्छ। तपाईंले नदिनुहोस्।

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
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-120b:free",
        messages: [{ role: "user", content: prompt }]
      },
      { 
        headers: { 
          "Authorization": `Bearer ${OR_KEY.trim()}`,
          "HTTP-Referer": "https://render.com",
          "X-Title": "Rashifal App"
        } 
      }
    );

    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    cache = { data: parsed.data, last_updated: new Date().toISOString() };
    console.log("✅ Success! Data cached.");
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.message);
  }
}

app.get("/api/rasifal", (req, res) => res.json(cache));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  generateRasifal();
});
