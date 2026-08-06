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

// राशिफल जेनेरेट गर्ने मुख्य फंक्सन (अति सरल र प्राकृतिक नेपाली भाषाको लागि अप्टिमाइज गरिएको)
async function generateRasifal() {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return false;
  }

  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];

  // एआईलाई 'हाम्रो पात्रो' र 'नेपाली पात्रो' को जस्तै एकदमै सरल र बग्ने नेपाली भाषामा लेख्न कडा निर्देशन दिइएको प्रोम्प्ट
  const prompt = `तपाईं नेपालको एक प्रतिष्ठित र लोकप्रिय पत्रिका (जस्तै हाम्रो पात्रो र कान्तिपुर) का लागि दैनिक राशिफल लेख्ने अनुभवी ज्योतिषी हुनुहुन्छ। आज अंग्रेजी मिति ${dateKey} र ${dayName} हो। यसको आधारमा नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 भाषा र लेखनशैली सम्बन्धी विशेष नियमहरू:
1. भाषा एकदमै सरल, सहज, बग्ने खालको (Flowing) र सर्वसाधारणले पढ्नेबित्तिकै बुझ्ने हुनुपर्छ। कडा वा अप्राकृतिक संस्कृत शब्दहरू प्रयोग नगर्नुहोस्।
2. "हाम्रो पात्रो" को राशिफलमा जस्तै स्वास्थ्य, व्यापार/कर्मक्षेत्र, आर्थिक र पारिवारिक सम्बन्धलाई जोडेर व्यावहारिक भविष्यवाणी दिनुहोस्।
3. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस् (न एक वाक्य बढी, न कम)।
4. कुनै पनि अङ्ग्रेजी शब्द, अक्षर वा चिकित्सासम्बन्धी अप्राकृतिक शब्द प्रयोग नगर्नुहोस्।
5. राशिको नाम prediction भित्र वा वाक्यको सुरुमा कहिल्यै नलेख्नुहोस्।
6. सकारात्मक, कर्मशील र यथार्थपरक सन्देश दिनुहोस्।
7. "यो दिन", "यस दिन", "आजको दिन", "आज तपाईँको" जस्ता घिस्रिएका शब्दबाट कुनै पनि राशिको वाक्य सुरु नगर्नुहोस्।

JSON Format (date_np मा नेपाली विक्रम संवत् जस्तै '२०८३ साउन २१, बिहीबार' र date मा अंग्रेजी मिति '2026-08-06' राख्नुहोला):
{
  "date_np": "२०८३ साउन २१, बिहीबार",
  "date": "${dateKey}",
  "day": "${dayName}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "४ वाक्यको सरल र प्राकृतिक राशिफल..."}
  ]
}

⚡ CRITICAL: Extra text वा markdown नदिनुहोस्, केवल valid JSON मात्र।`;

  try {
    console.log(`🔄 ${dateKey} (${dayName}) को लागि प्राकृतिक भाषाको राशिफल जेनेरेट हुँदैछ...`);
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

// हरेक दिन बिहान ठ्याक्कै ३ बजे नयाँ राशिफल जेनेरेट हुने क्रोन जोब
cron.schedule('0 3 * * *', () => {
  generateRasifal();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

// API Endpoints
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
    res.status(500).json({ status: "error", message: "जेनेरेट गर्न असफल भयो।" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!cache.data) {
    await generateRasifal(); 
  }
});
