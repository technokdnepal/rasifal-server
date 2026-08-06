const express = require("express");
const axios = require("axios");
const cors = require("cors");
const moment = require("moment-timezone");
const cron = require("node-cron");
require("dotenv").config();

process.env.TZ = "Asia/Kathmandu";
moment.tz.setDefault("Asia/Kathmandu");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const OR_KEY = process.env.OPENROUTER_API_KEY;

let cache = { data: null, last_updated: null };

async function generateRasifal() {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return false;
  }

  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];

  const prompt = `तपाईं नेपालको एक अनुभवी, शास्त्रीय ज्ञानयुक्त र प्रतिष्ठित वैदिक ज्योतिषी हुनुहुन्छ। ${dateKey} ${dayName} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 ज्योतिषीय आधार तथा निर्देशिका:
- ${dayName}को वारको प्रभाव, ग्रहहरूको सामान्य गोचर र नेपाली वैदिक पञ्चाङ्गको ऊर्जालाई आधार मान्नुहोस्।
- नेपालका शीर्ष पत्रपत्रिका (कानन्तिपुर, अन्नपूर्ण पोस्ट) तथा ख्यातिप्राप्त ज्योतिषीहरूको प्रामाणिक, गम्भीर र शास्त्रीय लेखनशैली अपनाउनुहोस्।
- प्रत्येक राशिका लागि स्वास्थ्य, व्यापार/नयाँ काम, आर्थिक स्थिति, पारिवारिक सम्बन्ध र विद्यार्थीहरूको पढाइलाई समेट्ने गरी व्यावहारिक भविष्यवाणी गर्नुहोस्।
- राशिफल पढ्दा पाठकले वास्तविक ज्योतिषीले उसको भाग्य र दिनको दिशा निर्देश गरेको महसुस गर्न सकून्।

✅ कडा नियमहरू:
1. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस् (न एक वाक्य बढी, न कम)।
2. क्लिष्ट वा बुझ्न कठिन संस्कृत शब्दभन्दा शुद्ध, स्वाभाविक र प्रवाहपूर्ण नेपाली भाषा प्रयोग गर्नुहोस्।
3. कुनै पनि अङ्ग्रेजी शब्द, अंग्रेजी अक्षर वा चिकित्सासम्बन्धी अप्राकृतिक शब्द प्रयोग नगर्नुहोस्।
4. राशिको नाम prediction भित्र वा वाक्यको सुरुमा कहिल्यै नलेख्नुहोस्।
5. अन्धविश्वासी बनाउनेभन्दा पनि कर्मशील, सकारात्मक तर यथार्थपरक र सचेत गराउने सन्देश दिनुहोस्।
6. "यो दिन", "यस दिन", "आजको दिन", "आज तपाईँको" जस्ता घिस्रिएका शब्दबाट कुनै पनि राशिको वाक्य सुरु नगर्नुहोस्। (उदाहरणको लागि सीधा काम, विचार वा स्थितिको वर्णनबाट सुरु गर्नुहोस्)।

JSON Format (केवल valid JSON मात्र, date र day सहित):
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

⚡ CRITICAL: Extra text वा markdown नदिनुहोस्, केवल JSON मात्र।`;
  try {
    console.log(`🔄 ${dateKey} को लागि राशिफल जेनेरेट हुँदैछ...`);
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-20b:free",
        messages: [{ role: "user", content: prompt }]
      },
      { 
        headers: { 
          "Authorization": `Bearer ${OR_KEY.trim()}`,
          "HTTP-Referer": "https://render.com",
          "X-Title": "Rashifal App"
        },
        timeout: 45000 
      }
    );

    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    cache = { data: parsed, last_updated: new Date().toISOString() };
    console.log("✅ Success! नयाँ राशिफल सफलतापूर्वक सेभ भयो।");
    return true;
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.message);
    return false;
  }
}

cron.schedule('0 3 * * *', () => {
  generateRasifal();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

app.get("/api/rasifal", (req, res) => {
  if (!cache.data) {
    return res.status(503).json({ error: "Service Unavailable", message: "राशिफल अद्यावधिक हुँदैछ।" });
  }
  res.json(cache.data);
});

app.get("/api/generate-now", async (req, res) => {
  console.log("🛠️ म्यानुअल रूपमा राशिफल जेनेरेट गर्ने आदेश प्राप्त भयो...");
  const success = await generateRasifal();
  if (success) {
    res.json({ status: "success", message: "नयाँ राशिफल सफलतापूर्वक जेनेरेट भयो!", data: cache.data });
  } else {
    res.status(500).json({ status: "error", message: "जेनेरेट गर्न असफल भयो। कन्ट्रोल लगर चेक गर्नुहोस्।" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await generateRasifal(); 
});
