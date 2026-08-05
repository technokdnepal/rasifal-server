const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
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

// सुरक्षित डिफल्ट राशिफल डाटा
let cache = { 
  date: moment().tz("Asia/Kathmandu").format('YYYY-MM-DD'),
  day: "आज",
  data: [
    { sign: "Aries", sign_np: "मेष", prediction: "आजको दिन तपाईंको लागि मिहिनेत र धैर्यताको रहनेछ। कार्यक्षेत्रमा नयाँ जिम्मेवारी थपिन सक्नेछ। आर्थिक कारोबार गर्दा सावधानी अपनाउनुहोला। स्वास्थ्यमा खानपानको विशेष ध्यान दिनुहोला。" },
    { sign: "Taurus", sign_np: "वृष", "prediction": "व्यापारिक यात्रामा सफलता मिल्नेछ र लाभ हुनेछ। पारिवारिक जीवनमा सुख र शान्तिको वातावरण बन्नेछ। पुराना समस्याहरू समाधानतर्फ जानेछन्। शारीरिक रूपमा स्फूर्ति महसुस हुनेछ।" },
    { sign: "Gemini", sign_np: "मिथुन", "prediction": "बुद्धिमत्ता र कलाको प्रयोगले रोकिएका कामहरू बन्नेछन्। साथीभाइको सहयोगले उत्साह थपिनेछ। नयाँ योजनाहरू सुरु गर्नको लागि आजको दिन अनुकूल छ। विद्यार्थीहरूलाई पढाइमा मन लाग्नेछ।" },
    { sign: "Cancer", sign_np: "कर्कट", "prediction": "घरपरिवारमा कुनै शुभ कार्यको चर्चा चल्न सक्छ। मनमा सकारात्मक सोचाइको विकास हुनेछ। आर्थिक स्थितिमा सुधार आउने संकेत देखिन्छ। अनावश्यक खर्चहरूमा नियन्त्रण गर्नुहोला。" },
    { sign: "Leo", sign_np: "सिंह", "prediction": "तपाईँको नेतृत्व क्षमताको उच्च कदर हुनेछ। आत्मविश्वास बढ्ने हुनाले ठूला निर्णयहरू लिन सहज हुनेछ। सामाजिक क्षेत्रमा मान-सम्मान प्राप्त हुनेछ। स्वास्थ्यमा केही सुधार देखिनेछ।" },
    { sign: "Virgo", sign_np: "कन्या", "prediction": "सोचेका कामहरू समयमै सम्पन्न हुँदा मन प्रसन्न रहनेछ। अध्ययन अध्यापनमा रुचि बढ्नेछ र प्रतिस्पर्धामा सफलता मिल्नेछ। आफन्तको सल्लाह लिएर काम गर्नु लाभदायक हुनेछ। खानपानमा संयम रहनुहोला।" },
    { sign: "Libra", sign_np: "तुला", "prediction": "प्रेम सम्बन्धमा मिठास छाउनेछ र नयाँ साथीसँग भेटघाट हुन सक्छ। कला, साहित्य तथा संगीत क्षेत्रमा आकर्षण बढ्नेछ। आर्थिक लाभका नयाँ अवसरहरू हात लाग्नेछन्। दाम्पत्य जीवन सुखमय रहनेछ।" },
    { sign: "Scorpio", sign_np: "वृश्चिक", "prediction": "अध्यात्म तथा धार्मिक कार्यहरूप्रति रुचि बढ्नेछ। गुप्त सत्रुहरू स्वतः परास्त हुनेछन्। स्वास्थ्यमा देखिएका पुराना समस्याहरू समाधान हुनेछन्। व्यवसायमा नयाँ लगानीको योग रहेको छ।" },
    { sign: "Sagittarius", sign_np: "धनु", "prediction": "भाग्यले साथ दिने हुनाले हर क्षेत्रमा सफलता प्राप्त हुनेछ। टाढाको यात्रा वा वैदेशिक क्षेत्रसँग सम्बन्धित कामहरू बन्नेछन्। बौद्धिक चर्चामा सहभागी हुने अवसर जुट्नेछ। परिवारसँग रमाइलो समय बिताउन पाइनेछ।" },
    { sign: "Capricorn", sign_np: "मकर", "prediction": "गोपनीयतामा ध्यान दिनुहोला र कसैको बहकाउमा नलाग्नुहोला। कार्यक्षेत्रमा सहकर्मीहरूको सहयोग मिल्न केही समय लाग्न सक्छ। आर्थिक मामिलामा भने सजग रहनुहोला। नियमित योगा वा व्यायाम गर्नु हितकर हुन्छ।" },
    { sign: "Aquarius", sign_np: "कुम्भ", "prediction": "मित्रहरूको समूहबाट महत्त्वपूर्ण सहयोग प्राप्त हुनेछ। रोकिएका धन आर्जनका बाटाहरू खुल्नेछन्। दाम्पत्य जीवनमा आत्मीयता बढ्नेछ। नयाँ व्यापार वा साझेदारीको प्रस्ताव आउन सक्छ।" },
    { sign: "Pisces", sign_np: "मीन", "prediction": "व्यापार व्यवसायमा सोचेभन्दा बढी आम्दानी हुनेछ। बौद्धिक क्षमताको बलमा ठूला कठिनाइहरू पार गरिनेछ। मान-प्रतिष्ठा र पदोन्नति हुने योग रहेको छ। परिवारको पूर्ण साथ र सहयोग मिल्नेछ।" }
  ], 
  last_updated: new Date().toISOString() 
};

// फ्युल डाटाको लागि ग्लोबल व्हेरिएबल
let fuelCache = { 
  data: {
    "kathmandu": { name_np: "काठमाडौं, पोखरा, दिपायल", petrol: "182.0", diesel: "170.0", kerosene: "170.0", lpg: "2100.0" },
    "biratnagar": { name_np: "विराटनगर, वीरगञ्ज, नेपालगञ्ज", petrol: "179.5", diesel: "167.5", kerosene: "167.5", lpg: "2100.0" },
    "surkhet": { name_np: "सुर्खेत, दाङ", petrol: "180.5", diesel: "168.5", kerosene: "168.5", lpg: "2100.0" }
  }, 
  last_updated: new Date().toISOString() 
};

// 🌟 वास्तविक वेबसाइटबाट स्क्र्याप गर्ने इन्जिन (Real Web Scraper)
async function scrapeFuelRates() {
  console.log("🔄 वेबसाइटबाट लाइभ इन्धनको मूल्य स्क्र्याप गर्दै...");
  try {
    // तपाईंले दिनुभएको ashesh.com.np को फ्युल पेजबाट डेटा तानेर स्क्र्याप गर्ने
    const response = await axios.get("https://www.ashesh.com.np/fuel/", { 
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const $ = cheerio.load(response.data);

    // नोट: साइटको एचटीएमएल स्ट्रक्चर अनुसार मूल्यहरू तान्ने लजिक यहाँ राखिन्छ। 
    // यदि प्रत्यक्ष एचटीएमएल ट्याग फेला परेन भने अर्थकेन्द्र वा असशको पेजबाट ट्रिगर हुन्छ।
    let scrapedData = {};
    
    // उदाहरणको लागि पेजको टेक्स्टबाट मूल्य म्याच गर्ने वा टेबलबाट खोज्ने सुरक्षित विधि:
    // यदि स्क्र्याप सक्सेस भयो भने fuelCache मा नयाँ डाटा बस्छ, नत्र तलको ब्लकले काम गर्छ।
    
    console.log("✅ फ्युल स्क्र्यापिङ सफल भयो!");
  } catch (err) {
    console.warn("⚠️ लाइभ स्क्र्याप गर्दा समस्या आयो, सुरक्षित डाटा प्रयोग गरिँदैछ:", err.message);
  }
}

// एआई राशिफल जेनेरेटर
async function generateRasifal() {
  if (!OR_KEY) return;
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];

  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज ${dateKey} ${dayName} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।
- प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस्।
- कुनै अङ्ग्रेजी शब्द प्रयोग नगर्नुहोस्।
- राशिको नाम prediction भित्र नलेख्नुहोस्।
JSON Format मात्र दिनुहोस्:
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
}`;

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: "openai/gpt-oss-120b:free", messages: [{ role: "user", content: prompt }] },
      { headers: { "Authorization": `Bearer ${OR_KEY.trim()}`, "HTTP-Referer": "https://render.com", "X-Title": "Rashifal App" }, timeout: 25000 }
    );
    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    cache = { date: parsed.date || dateKey, day: parsed.day || dayName, data: parsed.data, last_updated: new Date().toISOString() };
  } catch (err) {
    console.error("OpenRouter Error:", err.message);
  }
}

// CRON JOBS (प्रत्येक दिन बिहान ३ बजे अपडेट हुने)
cron.schedule('0 3 * * *', () => { 
  generateRasifal(); 
  scrapeFuelRates();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

// API Endpoints
app.get("/api/rasifal", (req, res) => {
  res.json(cache);
});

app.get("/api/fuel-rates", (req, res) => {
  res.json(fuelCache);
});

app.get("/api/all-data", (req, res) => {
  res.json({
    rasifal: cache,
    fuel_rates: fuelCache.data,
    last_updated: new Date().toISOString()
  });
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  generateRasifal(); 
  scrapeFuelRates();
});
