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

// ओपन राउटरका फ्रि मोडलहरूको लिस्ट (एउटा बन्द भए अर्कोमा अटो-सविच हुन्छ)
const FREE_AI_MODELS = [
  "openai/gpt-oss-20b:free",
  "google/gemma-2-9b-it:free",
  "meta-llama/llama-3-8b-instruct:free"
];

function getNepaliDateText() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dayNames = { 'Sunday': 'आइतबार', 'Monday': 'सोमबार', 'Tuesday': 'मङ्गलबार', 'Wednesday': 'बुधबार', 'Thursday': 'बिहीबार', 'Friday': 'शुक्रबार', 'Saturday': 'शनिबार' };
  const dayName = dayNames[nepalNow.format('dddd')];
  return {
    date_en: nepalNow.format('YYYY-MM-DD'),
    day: dayName
  };
}

// रेन्डम टाइम पर्खिने फंक्सन (सकभर मान्छेले चलाएको जस्तो देखाउन)
const randomDelay = (min = 3000, max = 6000) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
};

// सुरक्षित स्क्र्यापिङ (रेन्डम ग्याप सहित)
async function scrapeWithRetry(url, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🔍 [प्रयास ${attempt}/3] ${name} बाट डाटा तान्दै...`);
      const { data } = await axios.get(url, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9,ne;q=0.8"
        },
        timeout: 15000
      });
      const $ = cheerio.load(data);
      let scrapedText = "";
      $("p, div, span").each((i, el) => {
        scrapedText += $(el).text() + "\n";
      });
      if (scrapedText.length > 200) {
        console.log(`✅ ${name} बाट सफलतापूर्वक डाटा प्राप्त भयो!`);
        return { success: true, text: scrapedText };
      }
    } catch (err) {
      console.warn(`⚠️ ${name} प्रयास ${attempt} असफल: ${err.message}`);
      if (attempt < 3) await randomDelay(4000, 7000); // ४ देखि ७ सेकेन्ड रेन्डम पर्खिने
    }
  }
  return { success: false, text: null };
}

async function fetchRawData() {
  let result = await scrapeWithRetry("https://www.hamropatro.com/rashifal", "हाम्रो पात्रो");
  if (result.success) return { data: result.text, source: "HamroPatro" };

  console.log("⚠️ 'हाम्रो पात्रो' मा प्रयास असफल, 'नेपाली पात्रो' मा जाँदैछ...");
  await randomDelay(5000, 8000); // साइट फेਰ्दा अलि बढी ग्याप दिने
  let backupResult = await scrapeWithRetry("https://nepalipatro.com.np/nepali-rashifal", "नेपाली पात्रो");
  if (backupResult.success) return { data: backupResult.text, source: "NepaliPatro" };

  return { data: null, source: "None" };
}

// एउटा मोडल फेल भए अर्को फ्रि मोडल ट्राइ गर्ने AI फंक्सन
async function callOpenRouterWithFallback(promptText) {
  for (const model of FREE_AI_MODELS) {
    try {
      console.log(`🤖 AI मोडल प्रयोग गर्दैछ: [${model}]`);
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: model,
          messages: [{ role: "user", content: promptText }]
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
      return response.data; // सफल भएपछि यही डाटा फर्काउने
    } catch (err) {
      console.warn(`⚠️ मोडल [${model}] असफल भयो: ${err.response?.status || err.message}. अर्को मोडल ट्राइ गर्दै...`);
      await randomDelay(2000, 4000);
    }
  }
  throw new Error("❌ सबै फ्रि AI मोडलहरू असफल भए!");
}

// दुई-चरण (Two-Step) प्रशोधन
async function processAndGenerate(rawContent, dateEn, dayName, sourceUsed) {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return false;
  }

  let statusMessage = sourceUsed !== "None" ? "" : "Loading...";

  const prompt = `You are an expert astrologer and content writer. 
Step 1: First, read the following raw scraped horoscope data in Nepali, understand its core astrological meaning, and translate its essence into English internally.
Step 2: Then, using that English understanding, rewrite each of the 12 zodiac signs into **extremely simple, natural, and conversational Nepali language (जसरी साथीसँग चिया खाँदै गफ गरिन्छ)**. 

📌 Raw Scraped Data:
${rawContent ? rawContent.substring(0, 8000) : "Daily Horoscope"}

✅ Strict Rules for the Nepali Output:
1. **Each zodiac sign must have EXACTLY 4 sentences.**
2. Completely fresh, original writing (do not copy the original words directly).
3. Use everyday spoken words, avoid heavy or official Sanskrit words.
4. Never include the zodiac sign's name inside the prediction text or at the beginning.
5. Do not start sentences with phrases like "आजको दिन" or "यस दिन".

Return ONLY a valid JSON object matching this exact structure:
{
  "date_np": "२०८३ साउन २१, बिहीबार",
  "date": "${dateEn}",
  "day": "${dayName}",
  "status_message": "${statusMessage}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य。"},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य。"},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य。"},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य。"},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य。"},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य。"},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य。"}
  ]
}

⚡ CRITICAL: Do not include any extra markdown or text, only output valid JSON.`;

  try {
    const aiResponse = await callOpenRouterWithFallback(prompt);
    const content = aiResponse.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    cache = { data: JSON.parse(cleanJson), last_updated: new Date().toISOString() };
    console.log("✅ Success! सुरक्षित र अटो-ब्याकअप सहित नयाँ राशिफल तयार भयो।");
    return true;
  } catch (err) {
    console.error("❌ All AI Models Failed:", err.message);
    return false;
  }
}

async function runWorkflow() {
  const { date_en, day } = getNepaliDateText();
  console.log(`🚀 ${date_en} (${day}) को लागि राशिफल वर्कफ्लो सुरु हुँदैछ...`);

  const { data: rawData, source } = await fetchRawData();
  return await processAndGenerate(rawData, date_en, day, source);
}

cron.schedule('0 4 * * *', () => {
  runWorkflow();
}, { scheduled: true, timezone: "Asia/Kathmandu" });

app.get("/api/rasifal", (req, res) => {
  if (!cache.data) {
    return res.status(503).json({ error: "Service Unavailable", message: "Loading..." });
  }
  res.json(cache.data);
});

app.get("/api/generate-now", async (req, res) => {
  const success = await runWorkflow();
  if (success) {
    res.json({ status: "success", message: "सफलतापूर्वक जेनेरेट भयो!", data: cache.data });
  } else {
    res.status(500).json({ status: "error", message: "जेनेरेट गर्न असफल भयो।" });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!cache.data) {
    await runWorkflow();
  }
});
