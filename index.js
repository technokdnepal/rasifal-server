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

// सधैँ सुरक्षित रहने पूर्वनिर्धारित (Default) राशिफल डाटा
const defaultRashifalData = [
  { sign: "Aries", sign_np: "मेष", prediction: "आजको दिन सामान्य शुभ रहनेछ। नयाँ कामको थालनी गर्दा सोचविचार गर्नुहोला। आर्थिक पक्षमा सन्तुलन कायम राख्नुपर्छ। स्वास्थ्यमा खानपानतर्फ विशेष ध्यान दिनुहोला।" },
  { sign: "Taurus", sign_np: "वृष", prediction: "व्यापार व्यवसायमा लाभ मिल्नेछ। परिवारका सदस्यहरूसँग रमाइलो समय बित्नेछ। बौद्धिक क्षेत्रमा सफलता हात लाग्नेछ। मानसिक शान्तिका लागि ध्यान गर्नु लाभदायक हुन्छ।" },
  { sign: "Gemini", sign_np: "मिथुन", prediction: "मित्रहरूको सहयोगले अधुरा कामहरू पूरा हुनेछन्। नयाँ अवसरको सिर्जना हुनेछ। आर्थिक कारोबारमा सावधानी अपनाउनु होला। दाम्पत्य जीवन सुखमय रहनेछ।" },
  { sign: "Cancer", sign_np: "कर्कट", prediction: "महत्वपूर्ण निर्णय लिँदा घरका अनुभवी व्यक्तिको सल्लाह लिनुहोला। कार्यक्षेत्रमा जिम्मेवारी बढ्न सक्छ। यात्रा गर्दा सावधानी अपनाउनुहोला। स्वास्थ्य सामान्य रहनेछ।" },
  { sign: "Leo", sign_np: "सिंह", prediction: "आत्मविश्वासमा वृद्धि हुनेछ। सामाजिक काममा मन जानेछ र मानसम्मान मिल्नेछ। रोकिएका कामहरू सुचारू हुनेछन्। खानपानमा ध्यान दिनुहोला।" },
  { sign: "Virgo", sign_np: "कन्या", prediction: "पढाइलेखाइमा मन जानेछ। खर्च नियन्त्रणमा राख्नुपर्ने दिन छ। सहकर्मीहरूसँगको सम्बन्ध सुमधुर बनाउनुहोला। नयाँ योजनामा लगानी गर्नुअघि विचार गर्नुहोस्।" },
  { sign: "Libra", sign_np: "तुला", prediction: "प्रेम सम्बन्ध प्रगाढ बन्नेछ। कला तथा संगीत क्षेत्रमा रुचि बढ्नेछ। आर्थिक लाभका नयाँ बाटो खुल्नेछन्। मानसिक तनावबाट टाढा रहनुहोला।" },
  { sign: "Scorpio", sign_np: "वृश्चिक", prediction: "गोपनीयतामा ध्यान दिनुहोला। विरोधीहरू सक्रिय हुन सक्छन्, सचेत रहनुहोला। पारिवारिक सहयोग मिल्नेछ। स्वास्थ्यप्रति लापरवाही नगर्नुहोला।" },
  { sign: "Sagittarius", sign_np: "धनु", prediction: "भाग्यले साथ दिने हुनाले गरेका काममा सफलता मिल्नेछ। धार्मिक तथा सामाजिक कार्यमा सहभागिता जनाउने अवसर जुट्नेछ। दाम्पत्य जीवन खुसियाली रहनेछ।" },
  { sign: "Capricorn", sign_np: "मकर", prediction: "कार्यक्षेत्रमा मेहनतको उचित कदर हुनेछ। व्यापारमा फाइदा हुने योग छ। नयाँ जिम्मेवारी प्राप्त हुन सक्छ। अल्छीपन त्यागेर अगाडि बढ्नुहोला।" },
  { sign: "Aquarius", sign_np: "कुम्भ", prediction: "मित्रहरूसँग भेटघाट हुनेछ। रचनात्मक कार्यमा मन जानेछ। आर्थिक अवस्था सुदृढ बन्दै जानेछ। खानपानमा ध्यान दिएर स्वास्थ्यलाई राम्रो राख्नुहोला।" },
  { sign: "Pisces", sign_np: "मीन", prediction: "मन प्रसन्न रहनेछ। सोचेका कामहरू समयमै सम्पन्न हुनेछन्। विद्यार्थीहरूका लागि दिन राम्रो छ। परिवारका तर्फबाट राम्रो सहयोग प्राप्त हुनेछ।" }
];

let cache = { 
  date: moment().tz("Asia/Kathmandu").format('YYYY-MM-DD'), 
  data: defaultRashifalData, 
  last_updated: new Date().toISOString() 
};

async function generateRasifal(isForce = false) {
  if (!OR_KEY) {
    console.log("ℹ️ OpenRouter Key छैन, डिफल्ट डाटा प्रयोग भइरहेको छ।");
    return false;
  }

  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');

  if (!isForce && cache.date === dateKey && cache.data.length > 0 && cache.data !== defaultRashifalData) {
    console.log("ℹ️ आजको राशिफल पहिल्यै बनिसकेको छ।");
    return true;
  }

  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];

  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज ${dateKey} ${dayName} को लागि नेपाली भाषामा १२ राशिका दैनिक राशिफल तयार गर्नुहोस्।

📌 महत्वपूर्ण सन्दर्भ:
- नेपाली ज्योतिष परम्परा र नक्षत्रको प्रभावलाई आधार मानी भविष्यवाणी गर्नुहोस्।
- कान्तिपुर, BBC नेपाली जस्ता प्रतिष्ठित नेपाली साइटहरूको गम्भीर र प्रामाणिक राशिफल शैली अपनाउनुहोस्।
- दैनिक जीवनमा लागू हुने व्यावहारिक सल्लाह दिनुहोस्।

✅ कडा नियमहरू:
1. प्रत्येक राशिका लागि ठ्याक्कै ४ वाक्य मात्र लेख्नुहोस्।
2. **विशेष नियम:** कुनै पनि राशिको सुरुवातमै "सूर्यको गोचर", "चन्द्रमा र शुक्रको सहकार्य", "राहुको गोचर" जस्ता ग्रह वा गोचरका तात्विक नामहरू राखेर वाक्य सुरु **नगरुन्**। सीधै व्यक्तिको दिनको स्थिति, काम वा स्वभावबाट वाक्य सुरु गर्नुहोस्।
3. स्वाभाविक, प्रवाहपूर्ण र शुद्ध नेपाली भाषा प्रयोग गर्नुहोस्।
4. कुनै अङ्ग्रेजी शब्द प्रयोग नगर्नुहोस्।
5. राशिको नाम prediction भित्र नलेख्नुहोस्।
6. सकारात्मक तर यथार्थपरक सन्देश दिनुहोस्।

⚠️ विविधता अनिवार्य: 
- "आजको दिन", "आज तपाईँको" जस्ता दोहोरिने शब्दहरू नप्रयोग गर्नुहोस्।
- प्रत्येक राशिको सुरुवात फरक शैलीबाट गर्नुहोस्।

📝 लेखन शैली:
- पहिलो वाक्य: आजको समग्र प्रवृत्ति वा मुख्य अवसर/चुनौती।
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
    console.log(`🔄 ${dateKey} को लागि नयाँ राशिफल जेनेरेट हुँदैछ...`);
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-20b:free",
        messages: [{ role: "user", content: prompt }]
      },
      { 
        headers: { 
          "Authorization": `Bearer ${OR_KEY ? OR_KEY.trim() : ''}`,
          "HTTP-Referer": "https://render.com",
          "X-Title": "Rashifal App"
        } 
      }
    );

    const content = response.data.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);
    
    cache = { 
      date: dateKey, 
      data: parsed.data, 
      last_updated: new Date().toISOString() 
    };
    console.log("✅ Success! नयाँ राशिफल सफलतापूर्वक सेभ भयो।");
    return true;
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.response?.data || err.message);
    return false;
  }
}

cron.schedule('0 3 * * *', () => {
  generateRasifal(true);
}, { scheduled: true, timezone: "Asia/Kathmandu" });

// मुख्य राशिफल डाटा हेर्ने लिङ्क
app.get("/api/rasifal", (req, res) => {
  res.json({
    date: cache.date,
    data: cache.data,
    last_updated: cache.last_updated
  });
});

// 🚀 म्यानुअली एआई ट्रिगर गर्ने नयाँ लिङ्क (यसले हातको हात नयाँ बनाउँछ)
app.get("/api/generate-now", async (req, res) => {
  console.log("🛠️ म्यानुअल रूपमा राशिफल जेनेरेट गर्ने आदेश प्राप्त भयो...");
  const success = await generateRasifal(true);
  if (success) {
    res.json({ status: "success", message: "नयाँ राशिफल सफलतापूर्वक जेनेरेट भयो!", data: cache });
  } else {
    res.status(500).json({ status: "error", message: "जेनेरेट गर्न असफल भयो। OpenRouter Key वा कन्सोल लगर चेक गर्नुहोस्।" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  await generateRasifal(false); 
});
