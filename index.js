const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const cors = require("cors");
const moment = require("moment-timezone");
require("dotenv").config();

// ✅ Force Nepal timezone
process.env.TZ = "Asia/Kathmandu";
moment.tz.setDefault("Asia/Kathmandu");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.1-8b-instant";

let cache = {
  date_np: null,
  source: null,
  generated_at: null,
  last_checked: null,
  data: []
};

const SIGNS = [
  { en: "Aries", np: "मेष" },
  { en: "Taurus", np: "वृष" },
  { en: "Gemini", np: "मिथुन" },
  { en: "Cancer", np: "कर्कट" },
  { en: "Leo", np: "सिंह" },
  { en: "Virgo", np: "कन्या" },
  { en: "Libra", np: "तुला" },
  { en: "Scorpio", np: "वृश्चिक" },
  { en: "Sagittarius", np: "धनु" },
  { en: "Capricorn", np: "मकर" },
  { en: "Aquarius", np: "कुम्भ" },
  { en: "Pisces", np: "मीन" }
];

// ✅ Get Nepal current date/time
function getNepalDateTime() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const dayNames = {
    'Sunday': 'आइतबार',
    'Monday': 'सोमबार',
    'Tuesday': 'मङ्गलबार',
    'Wednesday': 'बुधबार',
    'Thursday': 'बिहिबार',
    'Friday': 'शुक्रबार',
    'Saturday': 'शनिबार'
  };
  
  return {
    dateAD: nepalNow.format('YYYY-MM-DD'),
    dayName: dayNames[nepalNow.format('dddd')],
    time: nepalNow.format('HH:mm:ss'),
    timestamp: nepalNow.valueOf()
  };
}

// ✅ CRITICAL: Extract date number from Nepali text
function extractNepaliDateNumber(dateText) {
  // Extract numbers from "०१ माघ २०८२" format
  const match = dateText.match(/[०-९]+\s*माघ/);
  if (!match) return null;
  
  // Convert Nepali digits to English
  const nepaliToEnglish = {
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
    '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
  };
  
  let numStr = match[0].replace(/\s*माघ/, '').trim();
  numStr = numStr.split('').map(c => nepaliToEnglish[c] || c).join('');
  return parseInt(numStr);
}

async function fetchHamroPatroNepali() {
  try {
    const res = await axios.get("https://www.hamropatro.com/rashifal", {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 20000
    });

    const $ = cheerio.load(res.data);

    let date_np = $(".articleTitle.fullWidth h2").first().text().replace("आज -", "").trim() || 
                  $(".date").first().text().replace("आज -", "").trim();

    let text = $("body").text().replace(/\s+/g, " ").trim();

    if (!date_np || text.length < 1000) return null;

    // ✅ CRITICAL: Validate scraped date
    const scrapedDateNum = extractNepaliDateNumber(date_np);
    const nepalTime = getNepalDateTime();
    
    console.log(`📅 Scraped: "${date_np}" (Date: ${scrapedDateNum})`);
    console.log(`⏰ Nepal Time: ${nepalTime.time}, Day: ${nepalTime.dayName}`);

    // ✅ Add correct day name if missing
    if (!date_np.includes('बार')) {
      date_np = `${date_np}, ${nepalTime.dayName}`;
    }

    return { date_np, text, scrapedDateNum };
  } catch (err) {
    console.error("❌ Scraping Error:", err.message);
    return null;
  }
}

async function generateRasifal() {
  const source = await fetchHamroPatroNepali();
  if (!source) {
    console.log("⚠️ Scraping failed, keeping existing cache");
    return false;
  }

  // ✅ CRITICAL: Check if already have this date
  if (cache.date_np && cache.date_np.includes(source.date_np.split(',')[0])) {
    console.log(`ℹ️ Already have data for ${source.date_np} - Skipping`);
    return true;
  }

  console.log(`🔄 NEW DATE! Generating for: ${source.date_np}`);

  const prompt = `
You are an expert Vedic astrologer. 

SOURCE CONTENT (Nepali, analyze the essence):
"${source.text.substring(0, 4000)}"

TASK:
Generate a daily horoscope for today (${source.date_np}) in PROFESSIONAL ENGLISH.

STRICT QUALITY RULES:
1. NO INTRODUCTIONS: Start directly with the core advice. NEVER mention the name of the zodiac sign (e.g., Aries, Taurus, etc.) anywhere inside the prediction text. Use different sentence starters for each sign to ensure diversity
2. SENTENCE COUNT: Exactly 5 professional sentences per sign. Use diverse vocabulary and avoid repetitive templates.
3. NO LABELS: Do not include the sign name (Aries, मेष, etc.) inside the prediction text.
4. NO DATA CONTAMINATION: Never mention lucky color or lucky number inside the prediction text.
5. PLANETARY LOGIC: Calculate a UNIQUE lucky color and number based on the planetary transits for ${source.date_np}. Use standard color names (e.g., Deep Red, Navy Blue).
6. SPELLING: Taurus Nepali name must be 'वृष' (NOT वृषभ), Cancer must be 'कर्कट', and Scorpio must be 'वृश्चिक'.
7. OUTPUT: Valid JSON only.

JSON STRUCTURE:
{
 "data": [
  {
    "sign": "Aries",
    "sign_np": "मेष",
    "prediction": "Five professional sentences starting directly with the daily outlook.",
    "lucky_color": "Celestial Color",
    "lucky_number": 7
  }
 ]
}
`;

  try {
    const aiRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        response_format: { type: "json_object" }
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const parsed = JSON.parse(aiRes.data.choices[0].message.content);

    const fixedData = SIGNS.map((s, index) => {
      const aiItem = parsed.data[index];
      return {
        sign: s.en,
        sign_np: s.np,
        prediction: aiItem.prediction,
        lucky_color: aiItem.lucky_color,
        lucky_number: aiItem.lucky_number
      };
    });

    cache = {
      date_np: source.date_np,
      source: "Groq AI (Hamro Patro Official)",
      generated_at: new Date().toISOString(),
      last_checked: new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" }),
      data: fixedData
    };

    console.log(`✅ SUCCESS! Updated to ${source.date_np}`);
    return true;
  } catch (err) {
    console.error("❌ AI Error:", err.message);
    return false;
  }
}

// ✅ CRON JOBS - Smart scheduling

// 1. Check every 30 minutes from 12 AM to 6 AM (wait for Hamro Patro update)
cron.schedule("*/30 0-6 * * *", async () => {
  console.log("🌙 Early morning check (waiting for Hamro Patro)...");
  await generateRasifal();
}, {
  timezone: "Asia/Kathmandu"
});

// 2. Frequent checks 6 AM - 10 AM (people wake up)
cron.schedule("*/15 6-10 * * *", async () => {
  console.log("☀️ Morning check...");
  await generateRasifal();
}, {
  timezone: "Asia/Kathmandu"
});

// 3. Hourly checks rest of the day
cron.schedule("0 11-23 * * *", async () => {
  console.log("🔄 Hourly check...");
  await generateRasifal();
}, {
  timezone: "Asia/Kathmandu"
});

// API Endpoints
app.get("/api/rasifal", (req, res) => {
  res.json(cache);
});

app.get("/api/rasifal/force-update", async (req, res) => {
  const ok = await generateRasifal();
  res.json({ 
    success: ok, 
    date: cache.date_np,
    timestamp: new Date().toISOString()
  });
});

app.get("/api/status", (req, res) => {
  const nepalTime = getNepalDateTime();
  res.json({
    server: "Online",
    timezone: "Asia/Kathmandu",
    current_time: nepalTime.time,
    current_date: nepalTime.dateAD,
    cached_date: cache.date_np,
    last_update: cache.generated_at
  });
});

app.listen(PORT, async () => {
  console.log(`🚀 Rasifal Server running on port ${PORT}`);
  console.log(`🌏 Timezone: Asia/Kathmandu`);
  console.log(`📅 Current Nepal Time: ${getNepalDateTime().time}`);
  await generateRasifal();
});
