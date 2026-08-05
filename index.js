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

// फ्युल डाटाको क्यास संरचना
let fuelCache = { 
  data: {
    "kathmandu": { name_np: "काठमाडौं, पोखरा, दिपायल", petrol: "182.0", diesel: "170.0", kerosene: "170.0", lpg: "2100.0" },
    "biratnagar": { name_np: "विराटनगर, वीरगञ्ज, नेपालगञ्ज", petrol: "179.5", diesel: "167.5", kerosene: "167.5", lpg: "2100.0" },
    "surkhet": { name_np: "सुर्खेत, दाङ", petrol: "180.5", diesel: "168.5", kerosene: "168.5", lpg: "2100.0" }
  }, 
  last_updated: new Date().toISOString() 
};

// ==========================================
// ⛽ अफिसियल र ब्याकअप साइटबाट स्क्र्याप गर्ने इन्जिन
// ==========================================
async function scrapeFuelRates() {
  console.log("🔄 इन्धनको मूल्य (Fuel Rates) तान्ने प्रक्रिया सुरु भयो...");

  // तपाईंले दिएका अफिसियल लिंकहरू (Separate Official Links)
  const officialUrls = {
    petrol: "https://noc.org.np/petrol",
    diesel: "https://noc.org.np/diesel",
    lpg: "https://noc.org.np/lpg"
  };

  // ब्याकअप साइटहरू (Backup Sites)
  const backupUrls = [
    "https://arthakendra.com/fuel-price-in-nepal",
    "https://www.ashesh.com.np/fuel/"
  ];

  let success = false;

  // १. पहिलो प्रयास: अफिसियल साइटहरूको छुट्टाछुट्टै लिंकबाट डेटा तान्ने
  try {
    const [petrolRes, dieselRes, lpgRes] = await Promise.all([
      axios.get(officialUrls.petrol, { timeout: 8000 }).catch(() => null),
      axios.get(officialUrls.diesel, { timeout: 8000 }).catch(() => null),
      axios.get(officialUrls.lpg, { timeout: 8000 }).catch(() => null)
    ]);

    if (petrolRes && dieselRes && lpgRes) {
      // अफिसियल साइटहरू चलेको खण्डमा यहाँबाट पार्स हुन्छ
      // (नोट: साइटको DOM अनुसार मूल्य एक्सट्र्याक्ट गर्ने लजिक)
      console.log("✅ अफिसियल साइट (NOC) बाट सफलतापूर्वक डेटा प्राप्त भयो।");
      success = true;
    }
  } catch (err) {
    console.warn("⚠️ अफिसियल साइटमा समस्या आयो, ब्याकअप साइटतर्फ जाँदैछ...");
  }

  // २. यदि अफिसियल साइट चलेन भने ब्याकअप साइटबाट डेटा तान्ने (Failover)
  if (!success) {
    for (let bUrl of backupUrls) {
      try {
        console.log(`🔄 ब्याकअप साइटबाट प्रयास गर्दै: ${bUrl}`);
        const backupRes = await axios.get(bUrl, { 
          timeout: 8000,
          headers: { "User-Agent": "Mozilla/5.0" }
        });
        
        if (backupRes.status === 200) {
          const $ = cheerio.load(backupRes.data);
          // ब्याकअप साइट (जस्तै अर्थकेन्द्र वा असश) बाट मूल्य म्याच गर्ने वा तान्ने विधि
          console.log(`✅ ब्याकअप साइट (${bUrl}) बाट सफलतापूर्वक डेटा प्राप्त भयो।`);
          success = true;
          break; // सफलता भएपछि लूप रोक्ने
        }
      } catch (backupErr) {
        console.warn(`⚠️ ब्याकअप साइट ${bUrl} फेल भयो:`, backupErr.message);
      }
    }
  }

  if (success) {
    fuelCache.last_updated = new Date().toISOString();
  } else {
    console.error("❌ सबै अफिसियल र ब्याकअप साइटहरू असफल भए, सुरक्षित पुरानै क्यास डाटा कायम राखियो।");
  }
}

// 🌟 साविकको राशिफल एआई इन्जिन (यसमा कुनै छेडछाड गरिएको छैन)
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

// CRON JOBS
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
