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

  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज ${dateKey} ${dayName} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 महत्वपूर्ण सन्दर्भ:
- नेपाली ज्योतिष परम्परा, आजको तिथि र नक्षत्रको प्रभावलाई आधार मानी भविष्यवाणी गर्नुहोस्।
- हाम्रो पात्रो, कान्तिपुर, BBC नेपाली जस्ता प्रतिष्ठित नेपाली साइटहरूको गम्भीर र प्रामाणिक राशिफल शैली अपनाउनुहोस्।
- दैनिक जीवनमा लागू हुने व्यावहारिक सल्लाह दिनुहोस् (अनावश्यक र जटिल शब्द नराख्नुहोस्)।

✅ कडा नियमहरू:
1. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस्।
2. स्वाभाविक, प्रवाहपूर्ण र शुद्ध नेपाली भाषा प्रयोग गर्नुहोस्।
3. कुनै अङ्ग्रेजी शब्द प्रयोग नगर्नुहोस्।
4. राशिको नाम prediction भित्र नलेख्नुहोस्।
5. सकारात्मक तर यथार्थपरक सन्देश दिनुहोस्।

⚠️ विविधता अनिवार्य:
- "आजको दिन", "आज तपाईँको" जस्ता दोहोरिने शब्दहरू नप्रयोग गर्नुहोस्।
- प्रत्येक राशिको सुरुवात फरक शैलीबाट गर्नुहोस् (जस्तै: "आर्थिक लाभको योग...", "करियरमा नयाँ मोड...", "स्वास्थ्यमा सुधार...", "सम्बन्धमा मिठास...")।

📝 लेखन शैली (परम्परागत र व्यावहारिक):
- पहिलो वाक्य: आजको गोचर अनुसार मुख्य प्रवृत्ति।
- दोस्रो वाक्य: करियर, शिक्षा वा कार्यक्षेत्रमा प्रभाव।
- तेस्रो वाक्य: आर्थिक अवस्था वा पारिवारिक सम्बन्ध।
- चौथो वाक्य: स्वास्थ्य वा विशेष सावधानी/सल्लाह।

⚠️ नोट: lucky_color र lucky_number app ले generate गर्छ। तपाईंले नदिनुहोस्।

JSON Format (केवल valid JSON मात्र):
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
}

⚡ CRITICAL: Extra text, markdown, explanation केही पनि नदिनुहोस्, केवल JSON मात्र।`;

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
