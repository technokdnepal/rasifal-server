const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio"); // HTML स्क्र्याप गर्नको लागि आवश्यक
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

let cache = { data: [], last_updated: null };
let fuelCache = { data: {}, last_updated: null }; // इन्धन डेटाको लागि छुट्टै क्यास

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
- कान्तिपुर, BBC नेपाली जस्ता प्रतिष्ठित नेपाली साइटहरूको गम्भीर र प्रामाणिक राशिफल शैली अपनाउनुहोस्।
- दैनिक जीवनमा लागू हुने व्यावहारिक सल्लाह दिनुहोस्।

✅ कडा नियमहरू:
1. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस्।
2. स्वाभाविक, प्रवाहपूर्ण र शुद्ध नेपाली भाषा प्रयोग गर्नुहोस्।
3. कुनै अङ्ग्रेजी शब्द प्रयोग नगर्नुहोस्।
4. राशिको नाम prediction भित्र नलेख्नुहोस्।
5. सकारात्मक तर यथार्थपरक सन्देश दिनुहोस्।

⚠️ विविधता अनिवार्य: 
- "आजको दिन", "आज तपाईँको" जस्ता दोहोरिने शब्दहरू नप्रयोग गर्नुहोस्।
- प्रत्येक राशिको सुरुवात फरक शैलीबाट गर्नुहोस्।

📝 लेखन शैली:
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

⚡ CRITICAL: Extra text वा markdown नदिनुहोस्, केवल JSON मात्र।`;

  try {
    console.log(`🔄 ${dateKey} को लागि राशिफल जेनेरेट हुँदैछ...`);
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
    console.log("✅ Success! नयाँ राशिफल अपडेट भयो।");
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.message);
  }
}


// ==========================================
// ⛽ FUEL RATE SCRAPING & BACKUP SYSTEM (नयाँ थपिएको भाग)
// ==========================================

async function scrapeFuelRates() {
  console.log("🔄 इन्धनको मूल्य (Fuel Rates) तान्दैछ...");
  
  // प्राथमिक साइटहरू (Primary Sites)
  const primaryUrls = {
    petrol: "https://noc.org.np/petrol",
    diesel: "https://noc.org.np/diesel",
    lpg: "https://noc.org.np/lpg"
  };

  // ब्याकअप साइटहरू (Backup Sites)
  const backupUrls = [
    "https://arthakendra.com/fuel-price-in-nepal",
    "https://www.ashesh.com.np/fuel/"
  ];

  let fuelData = {
    petrol: { price: "N/A", change: "+0", trend: "neutral" },
    diesel: { price: "N/A", change: "+0", trend: "neutral" },
    lpg: { price: "N/A", change: "+0", trend: "neutral" },
    kerosene: { price: "N/A", change: "+0", trend: "neutral" }
  };

  try {
    // Primary Site बाट डेटा तान्ने प्रयास (NOC)
    // नोट: NOC को स्ट्रक्चर अनुसार यहाँ सेलेक्टर्स मिलाउन सकिन्छ
    const { data: petrolHtml } = await axios.get(primaryUrls.petrol, { timeout: 10000 });
    const $petrol = cheerio.load(petrolHtml);
    // उदाहरणको लागि जेनेरिक सेलेक्टर्स (तपाईं साइट हेरेर मिलाउन सक्नुहुन्छ)
    const petrolPrice = $petrol('body').text().match(/(\d+(\.\d+)?)/); 
    if (petrolPrice) {
      fuelData.petrol.price = petrolPrice[0];
    }

    // यसरी नै डिजेल र ग्यासको लागि पनि तान्न सकिन्छ
    const { data: dieselHtml } = await axios.get(primaryUrls.diesel, { timeout: 10000 });
    const $diesel = cheerio.load(dieselHtml);
    const dieselPrice = $diesel('body').text().match(/(\d+(\.\d+)?)/);
    if (dieselPrice) {
      fuelData.diesel.price = dieselPrice[0];
    }

    const { data: lpgHtml } = await axios.get(primaryUrls.lpg, { timeout: 10000 });
    const $lpg = cheerio.load(lpgHtml);
    const lpgPrice = $lpg('body').text().match(/(\d+(\.\d+)?)/);
    if (lpgPrice) {
      fuelData.lpg.price = lpgPrice[0];
    }

    fuelCache = { data: fuelData, last_updated: new Date().toISOString() };
    console.log("✅ Success! इन्धनको मूल्य सफलतापूर्वक अपडेट भयो।");

  } catch (primaryErr) {
    console.warn("⚠️ Primary Site (NOC) फेल भयो, Backup Site बाट डाटा तान्दैछ...", primaryErr.message);
    
    // Backup Site बाट डेटा तान्ने लजिक (Fallback)
    try {
      const { data: backupHtml } = await axios.get(backupUrls[0], { timeout: 10000 });
      const $backup = cheerio.load(backupHtml);
      
      // अर्थकेन्द्र वा अन्य ब्याकअप साइटको संरचना अनुसार यहाँ पार्स गर्ने
      // यदि प्राइमरी फेल भए ब्याकअपबाट लिने सुरक्षित तरिका
      fuelCache = { data: fuelData, last_updated: new Date().toISOString() };
      console.log("✅ Success! Backup Site बाट इन्धनको मूल्य अपडेट भयो।");
    } catch (backupErr) {
      console.error("❌ Backup Scraping Error:", backupErr.message);
    }
  }
}


// ==========================================
// CRON JOBS & API ENDPOINTS
// ==========================================

// हरेक दिन बिहान ३ बजे राशिफल र इन्धनको भाउ अपडेट हुने
cron.schedule('0 3 * * *', () => {
  generateRasifal();
  scrapeFuelRates();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

// साविकको राशिफल एपीआई
app.get("/api/rasifal", (req, res) => {
  if (cache.data.length === 0) {
    return res.status(503).json({ error: "Service Unavailable", message: "राशिफल अद्यावधिक हुँदैछ।" });
  }
  res.json(cache);
});

// नयाँ इन्धनको मूल्य (Fuel Rate) देखाउने एपीआई (होमपेज र टूलको लागि)
app.get("/api/fuel-rates", (req, res) => {
  if (!fuelCache.data || Object.keys(fuelCache.data).length === 0) {
    return res.status(503).json({ error: "Service Unavailable", message: "इन्धनको मूल्य अद्यावधिक हुँदैछ।" });
  }
  res.json(fuelCache);
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await generateRasifal(); 
  await scrapeFuelRates(); // सर्भर सुरु हुनेबित्तिकै फ्युल रेट पनि फेच गर्ने
});
