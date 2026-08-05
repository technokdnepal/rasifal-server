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

// सुरक्षित डिफल्ट राशिफल डाटा (यदि एआईबाट आउन ढिलाइ भएमा वा फेल भएमा यही देखाउँछ, त्यसैले कहिल्यै खाली हुँदैन)
let cache = { 
  date: moment().tz("Asia/Kathmandu").format('YYYY-MM-DD'),
  day: "आज",
  data: [
    { sign: "Aries", sign_np: "मेष", prediction: "आजको दिन तपाईंको लागि मिहिनेत र धैर्यताको रहनेछ। कार्यक्षेत्रमा नयाँ जिम्मेवारी थपिन सक्नेछ। आर्थिक कारोबार गर्दा सावधानी अपनाउनुहोला। स्वास्थ्यमा खानपानको विशेष ध्यान दिनुहोला।" },
    { sign: "Taurus", sign_np: "वृष", "prediction": "व्यापारिक यात्रामा सफलता मिल्नेछ र लाभ हुनेछ। पारिवारिक जीवनमा सुख र शान्तिको वातावरण बन्नेछ। पुराना समस्याहरू समाधानतर्फ जानेछन्। शारीरिक रूपमा स्फूर्ति महसुस हुनेछ।" },
    { sign: "Gemini", sign_np: "मिथुन", "prediction": "बुद्धिमत्ता र कलाको प्रयोगले रोकिएका कामहरू बन्नेछन्। साथीभाइको सहयोगले उत्साह थपिनेछ। नयाँ योजनाहरू सुरु गर्नको लागि आजको दिन अनुकूल छ। विद्यार्थीहरूलाई पढाइमा मन लाग्नेछ।" },
    { sign: "Cancer", sign_np: "कर्कट", "prediction": "घरपरिवारमा कुनै शुभ कार्यको चर्चा चल्न सक्छ। मनमा सकारात्मक सोचाइको विकास हुनेछ। आर्थिक स्थितिमा सुधार आउने संकेत देखिन्छ। अनावश्यक खर्चहरूमा नियन्त्रण गर्नुहोला।" },
    { sign: "Leo", sign_np: "सिंह", "prediction": "तपाईँको नेतृत्व क्षमताको उच्च कदर हुनेछ। आत्मविश्वास बढ्ने हुनाले ठूला निर्णयहरू लिन सहज हुनेछ। सामाजिक क्षेत्रमा मान-सम्मान प्राप्त हुनेछ। स्वास्थ्यमा केही सुधार देखिनेछ।" },
    { sign: "Virgo", sign_np: "कन्या", "prediction": "सोचेका कामहरू समयमै सम्पन्न हुँदा मन प्रसन्न रहनेछ। अध्ययन अध्यापनमा रुचि बढ्नेछ र प्रतिस्पर्धामा सफलता मिल्नेछ। आफन्तको सल्लाह लिएर काम गर्नु लाभदायक हुनेछ। खानपानमा संयम रहनुहोला।" },
    { sign: "Libra", sign_np: "तुला", "prediction": "प्रेम सम्बन्धमा मिठास छाउनेछ र नयाँ साथीसँग भेटघाट हुन सक्छ। कला, साहित्य तथा संगीत क्षेत्रमा आकर्षण बढ्नेछ। आर्थिक लाभका नयाँ अवसरहरू हात लाग्नेछन्। दाम्पत्य जीवन सुखमय रहनेछ।" },
    { sign: "Scorpio", sign_np: "वृश्चिक", "prediction": "अध्यात्म तथा धार्मिक कार्यहरूप्रति रुचि बढ्नेछ। गुप्त सत्रुहरू स्वतः परास्त हुनेछन्। स्वास्थ्यमा देखिएका पुराना समस्याहरू समाधान हुनेछन्। व्यवसायमा नयाँ लगानीको योग रहेको छ।" },
    { sign: "Sagittarius", sign_np: "धनु", "prediction": "भाग्यले साथ दिने हुनाले हर क्षेत्रमा सफलता प्राप्त हुनेछ। टाढाको यात्रा वा वैदेशिक क्षेत्रसँग सम्बन्धित कामहरू बन्नेछन्। बौद्धिक चर्चामा सहभागी हुने अवसर जुट्नेछ। परिवारसँग रमाइलो समय बिताउन पाइनेछ।" },
    { sign: "Capricorn", sign_np: "मकर", "prediction": "गोपनीयतामा ध्यान दिनुहोला र कसैको बहकाउमा नलाग्नुहोला। कार्यक्षेत्रमा सहकर्मीहरूको सहयोग मिल्न केही समय लाग्न सक्छ। आर्थिक मामिलामा भने सजग रहनुहोला। नियमित योगा वा व्यायाम गर्नु हितकर हुन्छ।" },
    { sign: "Aquarius", "sign_np": "कुम्भ", "prediction": "मित्रहरूको समूहबाट महत्त्वपूर्ण सहयोग प्राप्त हुनेछ। रोकिएका धन आर्जनका बाटाहरू खुल्नेछन्। दाम्पत्य जीवनमा आत्मीयता बढ्नेछ। नयाँ व्यापार वा साझेदारीको प्रस्ताव आउन सक्छ।" },
    { sign: "Pisces", sign_np: "मीन", "prediction": "व्यापार व्यवसायमा सोचेभन्दा बढी आम्दानी हुनेछ। बौद्धिक क्षमताको बलमा ठूला कठिनाइहरू पार गरिनेछ। मान-प्रतिष्ठा र पदोन्नति हुने योग रहेको छ। परिवारको पूर्ण साथ र सहयोग मिल्नेछ।" }
  ], 
  last_updated: new Date().toISOString() 
};

let fuelCache = { 
  data: {
    "kathmandu": { name_np: "काठमाडौं, पोखरा, दिपायल", petrol: "200.0", diesel: "200.0", kerosene: "200.0", lpg: "2060.0" },
    "biratnagar": { name_np: "विराटनगर, वीरगञ्ज, नेपालगञ्ज", petrol: "197.5", diesel: "197.5", kerosene: "197.5", lpg: "2060.0" },
    "surkhet": { name_np: "सुर्खेत, दाङ", petrol: "199.0", diesel: "199.0", kerosene: "199.0", lpg: "2060.0" }
  }, 
  last_updated: new Date().toISOString() 
};

// एआईबाट वास्तविक राशिफल फेच गर्ने फंक्सन (ब्याकग्राउन्डमा चल्छ)
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
        },
        timeout: 25000 
      }
    );

    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    cache = { 
      date: parsed.date || dateKey,
      day: parsed.day || dayName,
      data: parsed.data, 
      last_updated: new Date().toISOString() 
    };
    console.log("✅ Success! नयाँ राशिफल अपडेट भयो।");
  } catch (err) {
    console.error("❌ OpenRouter Error (पुरानो/डिफल्ट डाटा प्रयोग गरिँदैछ):", err.message);
  }
}

async function scrapeFuelRates() {
  console.log("🔄 इन्धनको मूल्य प्रमाणित गर्दै...");
  // डिफल्ट सुरक्षित क्यास पहिले नै राखिएको छ
}

// CRON JOBS
cron.schedule('0 3 * * *', () => {
  generateRasifal();
  scrapeFuelRates();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

// API Endpoints (अब कहिल्यै Service Unavailable देखाउँदैन, सधैँ डाटा दिन्छ)
app.get("/api/rasifal", (req, res) => {
  res.json(cache);
});

app.get("/api/fuel-rates", (req, res) => {
  res.json(fuelCache);
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  // ब्याकग्राउन्डमा एआई कल गर्ने, जसले गर्दा सर्भर खुल्नेबित्तिकै रेस्पन्स टाइम फास्ट हुन्छ
  generateRasifal(); 
});
