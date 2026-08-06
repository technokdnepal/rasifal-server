const express = require("express");
const axios = require("axios");
const cors = require("cors");
const moment = require("moment-timezone");
const cron = require("node-cron");
const cheerio = require("cheerio");
require("dotenv").config();

process.env.TZ = "Asia/Kathmandu";
moment.tz.setDefault("Asia/Kathmandu");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const OR_KEY = process.env.OPENROUTER_API_KEY;

let cache = { data: null, last_updated: null };

function getNepaliDateText() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];
  return {
    date_en: nepalNow.format('YYYY-MM-DD'),
    day: dayName
  };
}

// १. 'हाम्रो पात्रो' बाट डाटा तान्ने
async function scrapeHamroPatro() {
  try {
    console.log("🔍 Axios मार्फत 'हाम्रो पात्रो' बाट डाटा तान्दै...");
    const { data } = await axios.get("https://www.hamropatro.com/rashifal", {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9,ne;q=0.8"
      },
      timeout: 15000
    });
    const $ = cheerio.load(data);
    let scrapedText = "";
    // राशिफलका मुख्य कन्टेन्टहरू वा सबै प्याराग्राफहरू तान्ने
    $("p, div, span").each((i, el) => {
      scrapedText += $(el).text() + "\n";
    });
    return scrapedText;
  } catch (err) {
    console.error("❌ 'हाम्रो पात्रो' स्क्र्यापिङ एरर:", err.message);
    return null;
  }
}

// २. 'नेपाली पात्रो' (ब्याकअप) बाट डाटा तान्ने
async function scrapeNepaliPatro() {
  try {
    console.log("🔍 Axios मार्फत 'नेपाली पात्रो' (ब्याकअप) बाट डाटा तान्दै...");
    const { data } = await axios.get("https://nepalipatro.com.np/nepali-rashifal", {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      },
      timeout: 15000
    });
    const $ = cheerio.load(data);
    let scrapedText = "";
    $("p, div, span").each((i, el) => {
      scrapedText += $(el).text() + "\n";
    });
    return scrapedText;
  } catch (err) {
    console.error("❌ 'नेपाली पात्रो' स्क्र्यापिङ एरर:", err.message);
    return null;
  }
}

// ३. AI मार्फत प्रशोधन र जेनेरेट गर्ने
async function processAndGenerate(rawContent, dateEn, dayName) {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return false;
  }

  const prompt = `तपाईं नेपालको एक प्रतिष्ठित र लोकप्रिय पत्रिकाका लागि दैनिक राशिफल लेख्ने अनुभवी ज्योतिषी हुनुहुन्छ। आज अंग्रेजी मिति ${dateEn} (${dayName}) हो। तल दिइएको स्रोत डाटालाई आधार मानी नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 स्रोत डेटा:
${rawContent ? rawContent.substring(0, 8000) : "नवीनतम राशिफल"}

✅ कडा नियमहरू:
1. भाषा एकदमै सरल, सहज, बग्ने खालको (Flowing) र सर्वसाधारणले पढ्नेबित्तिकै बुझ्ने हुनुपर्छ। कडा वा अप्राकृतिक शब्दहरू प्रयोग नगर्नुहोस्।
2. "हाम्रो पात्रो" को राशिफलमा जस्तै स्वास्थ्य, व्यापार/कर्मक्षेत्र, आर्थिक र पारिवारिक सम्बन्धलाई जोडेर व्यावहारिक भविष्यवाणी दिनुहोस्।
3. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस् (न एक वाक्य बढी, न कम)।
4. कुनै पनि अङ्ग्रेजी शब्द वा चिकित्सासम्बन्धी अप्राकृतिक शब्द प्रयोग नगर्नुहोस्।
5. राशिको नाम prediction भित्र वा वाक्यको सुरुमा कहिल्यै नलेख्नुहोस्।
6. सकारात्मक, कर्मशील र यथार्थपरक सन्देश दिनुहोस्।
7. "यो दिन", "यस दिन", "आजको दिन", "आज तपाईँको" जस्ता घिस्रिएका शब्दबाट कुनै पनि राशिको वाक्य सुरु नगर्नुहोस्।

JSON Format (date_np मा नेपाली विक्रम संवत् जस्तै '२०८३ साउन २१, बिहीबार' र date मा अंग्रेजी मिति '${dateEn}' राख्नुहोला):
{
  "date_np": "२०८३ साउन २१, बिहीबार",
  "date": "${dateEn}",
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

⚡ CRITICAL: केवल valid JSON मात्र दिनुहोस्।`;

  try {
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
    cache = { data: JSON.parse(cleanJson), last_updated: new Date().toISOString() };
    console.log("✅ Success! राशिफल सफलतापूर्वक जेनेरेट भयो।");
    return true;
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.message);
    return false;
  }
}

// ४. स्मार्ट र पक्का म्यानेजर फंक्सन
async function runSmartScraperAndGenerate() {
  const { date_en, day } = getNepaliDateText();
  console.log(`🚀 ${date_en} (${day}) को लागि प्रक्रिया सुरु हुँदैछ...`);

  // हाम्रो पात्रोबाट डाटा तानेर सीधै एआईमा पठाउने
  let rawData = await scrapeHamroPatro();
  if (rawData && rawData.length > 200) {
    console.log("✅ 'हाम्रो पात्रो' बाट डाटा प्राप्त भयो, एआईमा पठाइँदैछ...");
    return await processAndGenerate(rawData, date_en, day);
  }

  // यदि आएन भने नेपाली पात्रोबाट प्रयास गर्ने
  console.log("⚠️ 'हाम्रो पात्रो' बाट आएन, 'नेपाली पात्रो' मा प्रयास गर्दै...");
  let backupData = await scrapeNepaliPatro();
  if (backupData && backupData.length > 200) {
    console.log("✅ 'नेपाली पात्रो' बाट डाटा प्राप्त भयो, एआईमा पठाइँदैछ...");
    return await processAndGenerate(backupData, date_en, day);
  }

  // यदि दुवैबाट ताkes भएन भने पनि एआईको आफ्नै वैदिक ज्ञान प्रयोग गरेर आजको ताजा राशिफल जेनेरेट गराउने (कहिल्यै फेल नहुने ब्याकअप)
  console.log("⚠️ साइटबाट सिधै तानेन, एआईको वैदिक मोड्युलबाट जेनेरेट गर्दै...");
  return await processAndGenerate("", date_en, day);
}

cron.schedule('0 4 * * *', () => {
  runSmartScraperAndGenerate();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

app.get("/api/rasifal", (req, res) => {
  if (!cache.data) {
    return res.status(503).json({ error: "Service Unavailable", message: "राशिफल अद्यावधिक हुँदैछ।" });
  }
  res.json(cache.data);
});

app.get("/api/generate-now", async (req, res) => {
  const success = await runSmartScraperAndGenerate();
  if (success) {
    res.json({ status: "success", message: "सफलतापूर्वक जेनेरेट भयो!", data: cache.data });
  } else {
    res.status(500).json({ status: "error", message: "जेनेरेट गर्न असफल भयो।" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!cache.data) {
    await runSmartScraperAndGenerate();
  }
});
