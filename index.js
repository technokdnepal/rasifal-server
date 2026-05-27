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

// यहाँ तपाईंले आफ्नो रेन्डरको Environment मा राखेको नाम प्रयोग गर्नुस्
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; 

let cache = {
  date_np: null,
  source: "OpenRouter AI",
  generated_at: null,
  data: []
};

async function generateRasifal() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dateKey = nepalNow.format('YYYY-MM-DD');
  const dayName = nepalNow.format('dddd');

  const prompt = `तपाईं नेपालको एक अनुभवी वैदिक ज्योतिषी हुनुहुन्छ। आज मिति ${dateKey} (${dayName}) को लागि १२ राशिका दैनिक राशिफल तयार गर्नुहोस्। 
  नियम: JSON ढाँचामा मात्र उत्तर दिनुहोस्। प्रत्येक राशिको लागि ४ वाक्य मात्र। राशिको नाम Prediction भित्र नलेख्नुहोस्।`;

  try {
    const aiRes = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions", // OpenRouter को URL
      {
        model: "openai/gpt-oss-120b:free", // तपाईंको मोडलको नाम
        messages: [{ role: "user", content: prompt }]
      },
      { 
        headers: { 
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`, 
          "HTTP-Referer": "https://rasifal-server.onrender.com", // OpenRouter लाई अनिवार्य चाहिन्छ
          "X-Title": "Rashifal App",
          "Content-Type": "application/json" 
        } 
      }
    );

    const parsed = JSON.parse(aiRes.data.choices[0].message.content);
    
    cache = {
      date_np: dateKey,
      source: "OpenRouter AI",
      generated_at: new Date().toISOString(),
      data: parsed.data
    };
    return true;
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.response ? err.response.data : err.message);
    return false;
  }
}

app.get("/api/rasifal", (req, res) => res.json(cache));
app.listen(PORT, async () => {
  await generateRasifal();
});
