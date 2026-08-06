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

// साइटबाट डाटा तान्ने (३ पटकसम्म प्रयास गर्ने)
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
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  return { success: false, text: null };
}

async function fetchRawData() {
  let result = await scrapeWithRetry("https://www.hamropatro.com/rashifal", "हाम्रो पात्रो");
  if (result.success) return { data: result.text, source: "HamroPatro" };

  console.log("⚠️ 'हाम्रो पात्रो' मा प्रयास असफल, 'नेपाली पात्रो' मा जाँदैछ...");
  let backupResult = await scrapeWithRetry("https://nepalipatro.com.np/nepali-rashifal", "नेपाली पात्रो");
  if (backupResult.success) return { data: backupResult.text, source: "NepaliPatro" };

  return { data: null, source: "None" };
}

// OpenRouter मा 429 एरर आएमा Retry गर्ने फंक्सन
async function callOpenRouterWithRetry(promptText) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🤖 [AI प्रयास ${attempt}/3] OpenRouter लाई कल गर्दै...`);
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: "openai/gpt-oss-20b:free",
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
      return response.data;
    } catch (err) {
      console.warn(`⚠️ AI प्रयास ${attempt} असफल (Status: ${err.response?.status || err.message})`);
      if (attempt < 3) {
        // ४२९ एरर आएमा अलि बढी समय (५ सेकेन्ड) पर्खेर फेरि ट्राइ गर्ने
        const waitTime = err.response?.status === 429 ? 6000 : 3000;
        console.log(`⏳ ${waitTime/1000} सेकेन्ड पर्खिंदै...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw err;
      }
    }
  }
}

// एआई प्रशोधन र चिया पसल शैलीको भाषा रूपान्तरण
async function processAndGenerate(rawContent, dateEn, dayName, sourceUsed) {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return false;
  }

  // तपाईंले भन्नुभए अनुसार 'Loading...' म्यासेज राखिएको छ
  let statusMessage = sourceUsed !== "None" ? "" : "Loading...";

  const prompt = `You are a friendly, expert astrologer who speaks like a close friend chatting casually over tea (चिया पसलको मीठो र सजिलो बोलचालको भाषा). 
Step 1: Read the raw scraped horoscope data and understand its meaning in English.
Step 2: Rewrite each of the 12 zodiac signs in **extremely simple, natural, and conversational Nepali (जसरी साथीसँग चिया खाँदै गफ गरिन्छ)**. Avoid heavy, robotic, or overly official words. Make it sound warm and easy to read.

📌 Raw Data:
${rawContent ? rawContent.substring(0, 8000) : "Daily Horoscope"}

✅ Strict Rules for the Nepali Output:
1. **Each zodiac sign must have EXACTLY 4 sentences.**
2. Completely fresh and original writing (no direct copying).
3. Use everyday spoken words.
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
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य।"}
  ]
}

⚡ CRITICAL: Do not include any extra markdown or text, only output valid JSON.`;

  try {
    const aiResponse = await callOpenRouterWithRetry(prompt);
    const content = aiResponse.choices[0].message.content;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    cache = { data: JSON.parse(cleanJson), last_updated: new Date().toISOString() };
    console.log("✅ Success! चिया पसल शैलीमा नयाँ राशिफल तयार भयो।");
    return true;
  } catch (err) {
    console.error("❌ OpenRouter Error Final Failure:", err.message);
    return false;
  }
}

// मुख्य वर्कफ्लो म्यानेजर
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
