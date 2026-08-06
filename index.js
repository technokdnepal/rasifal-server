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

// 1. हाम्रो पात्रोबाट स्क्र्याप गर्ने फंक्सन
async function scrapeHamroPatro() {
  try {
    console.log("🔍 'हाम्रो पात्रो' बाट राशिफल स्क्र्याप गर्दै...");
    const { data } = await axios.get("https://www.hamropatro.com/rashifal", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 10000
    });
    const $ = cheerio.load(data);
    let scrapedText = "";
    
    // साइटको संरचना अनुसार डेटा संकलन (selectors लाई आवश्यकता अनुसार मिलाउन सकिन्छ)
    $(".rashifal-list, .content, .item").each((i, el) => {
      scrapedText += $(el).text() + "\n";
    });

    if (!scrapedText || scrapedText.length < 100) {
      // यदि क्लास फेला परेन भने सम्पूर्ण बडीको टेक्स्ट लिने
      scrapedText = $("body").text();
    }
    return scrapedText;
  } catch (err) {
    console.error("❌ 'हाम्रो पात्रो' स्क्र्यापिङ एरर:", err.message);
    return null;
  }
}

// 2. नेपाली पात्रोबाट स्क्र्याप गर्ने फंक्सन (ब्याकअप)
async function scrapeNepaliPatro() {
  try {
    console.log("🔍 'नेपाली पात्रो' (ब्याकअप) बाट राशिफल स्क्र्याप गर्दै...");
    const { data } = await axios.get("https://nepalipatro.com.np/nepali-rashifal", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      timeout: 10000
    });
    const $ = cheerio.load(data);
    let scrapedText = "";
    
    $("body").each((i, el) => {
      scrapedText += $(el).text() + "\n";
    });

    return scrapedText;
  } catch (err) {
    console.error("❌ 'नेपाली पात्रो' स्क्र्यापिङ एरर:", err.message);
    return null;
  }
}

// 3. AI मार्फत प्रशोधन र जेनेरेट गर्ने फंक्सन
async function processAndGenerate(rawContent, dateKey, dayName) {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return false;
  }

  const prompt = `तपाईं नेपालको एक अनुभवी, शास्त्रीय ज्ञानयुक्त र प्रतिष्ठित वैदिक ज्योतिषी हुनुहुन्छ। ${dateKey} ${dayName} को लागि तल दिइएको वास्तविक राशिफलको स्रोत डेटा (Raw Data) लाई पढेर, त्यसको मुख्य सारलाई आधार मानी नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 स्रोत डेटा (हाम्रो/नेपाली पात्रोबाट तानेको):
${rawContent.substring(0, 8000)}

✅ कडा नियमहरू:
1. स्रोतको भाव मिल्नुपर्छ तर शब्दहरूलाई अझै सरल, स्वाभाविक, प्रवाहपूर्ण र शुद्ध नेपाली बनाउनुहोस् ताकि सबैले बुझ्न सकून्।
2. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस् (न एक वाक्य बढी, न कम)।
3. कुनै पनि अङ्ग्रेजी शब्द, अक्षर वा चिकित्सासम्बन्धी अप्राकृतिक शब्द प्रयोग नगर्नुहोस्।
4. राशिको नाम prediction भित्र वा वाक्यको सुरुमा कहिल्यै नलेख्नुहोस्।
5. सकारात्मक, व्यावहारिक र यथार्थपरक सन्देश दिनुहोस्।
6. "यो दिन", "यस दिन", "आजको दिन", "आज तपाईँको" जस्ता घिस्रिएका शब्दबाट कुनै पनि राशिको वाक्य सुरु नगर्नुहोस्।

JSON Format (केवल valid JSON मात्र, date र day सहित):
{
  "date": "${dateKey}",
  "day": "${dayName}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "४ वाक्यको सरल र परिमार्जित राशिफल..."}
  ]
}

⚡ CRITICAL: Extra text वा markdown नदिनुहोस्, केवल JSON मात्र।`;

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
    const parsed = JSON.parse(cleanJson);
    
    cache = { data: parsed, last_updated: new Date().toISOString() };
    console.log("✅ Success! नयाँ राशिफल सफलतापूर्वक स्क्र्याप र जेनेरेट भयो।");
    return true;
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.message);
    return false;
  }
}

// 4. स्मार्ट रिट्राय लजिकसहितको मुख्य म्यानेजर फंक्सन
async function runSmartScraperAndGenerate() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];

  console.log(`🚀 ${dateKey} (${dayName}) को लागि राशिफल प्रक्रिया सुरु हुँदैछ...`);

  // प्रयास १: बिहान ४:०० बजे
  let rawData = await scrapeHamroPatro();
  if (rawData && rawData.includes(dateKey)) {
    return await processAndGenerate(rawData, dateKey, dayName);
  }

  // प्रयास २: ३० मिनेट पछि (४:३० बजे)
  console.log("⏳ पहिलो प्रयासमा मिति वा डेटा फेला परेन, ३० मिनेटपछि फेरि प्रयास गर्दै...");
  await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000));
  rawData = await scrapeHamroPatro();
  if (rawData) {
    return await processAndGenerate(rawData, dateKey, dayName);
  }

  // प्रयास ३: १ घण्टा पछि (५:३० बजे)
  console.log("⏳ दोस्रो प्रयास पनि असफल, १ घण्टାपछि फेरि प्रयास गर्दै...");
  await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000));
  rawData = await scrapeHamroPatro();
  if (rawData) {
    return await processAndGenerate(rawData, dateKey, dayName);
  }

  // प्रयास ४: थप १ घण्टा पछि (६:३० बजे - अन्तिम प्रयास हाम्रो पात्रोमा)
  console.log("⏳ तेस्रो प्रयास पनि असफल, अन्तिमपटक ६:३० बजे प्रयास गर्दै...");
  await new Promise(resolve => setTimeout(resolve, 60 * 60 * 1000));
  rawData = await scrapeHamroPatro();
  if (rawData) {
    return await processAndGenerate(rawData, dateKey, dayName);
  }

  // यदि ७ बजेसम्म पनि 'हाम्रो पात्रो' बाट डेटा आएन भने 'नेपाली पात्रो' (ब्याकअप साइट) मा जाने
  console.log("⚠️ 'हाम्रो पात्रो' बाट ७ बजेसम्म डेटा प्राप्त भएन। अब 'नेपाली पात्रो' मा ब्याकअप प्रयास गर्दै...");
  let backupData = await scrapeNepaliPatro();
  if (backupData) {
    return await processAndGenerate(backupData, dateKey, dayName);
  }

  console.error("❌ सबै प्रयासहरू असफल भए! आज नयाँ राशिफल जेनेरेट हुन सकेन।");
  return false;
}

// ५. क्रोन जोब सेटिङ (हरेक दिन बिहान ४:०० बजे ट्रिगर हुने)
cron.schedule('0 4 * * *', () => {
  runSmartScraperAndGenerate();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

// API Endpoints
app.get("/api/rasifal", (req, res) => {
  if (!cache.data) {
    return res.status(503).json({ error: "Service Unavailable", message: "राशिफल अद्यावधिक हुँदैछ वा आजको डेटा आइसकेको छैन।" });
  }
  res.json(cache.data);
});

app.get("/api/generate-now", async (req, res) => {
  console.log("🛠️ म्यानुअल रूपमा स्मार्ट स्क्र्यापिङ र जेनेरेसन आदेश प्राप्त भयो...");
  const success = await runSmartScraperAndGenerate();
  if (success) {
    res.json({ status: "success", message: "नयाँ राशिफल सफलतापूर्वक स्क्र्याप र जेनेरेट भयो!", data: cache.data });
  } else {
    res.status(500).json({ status: "error", message: "जेनेरेट गर्न असफल भयो। कन्ट्रोल लगर चेक गर्नुहोस्।" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // सर्भर अन हुनेबित्तिकै यदि क्यास खाली छ भने एकपटक डेटा तान्न प्रयास गर्ने
  if (!cache.data) {
    await runSmartScraperAndGenerate();
  }
});
