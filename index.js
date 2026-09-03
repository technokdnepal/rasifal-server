const express = require("express");
const axios = require("axios");
const cors = require("cors");
const moment = require("moment-timezone");
const cron = require("node-cron");
const cheerio = require("cheerio");
const { GoogleGenAI } = require("@google/genai");
const { adToBs } = require("@sbmdkl/nepali-date-converter");
require("dotenv").config();

process.env.TZ = "Asia/Kathmandu";
moment.tz.setDefault("Asia/Kathmandu");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// 🟢 गुगल जेमिनीको एपीआई की सेटअप (Render मा GEMINI_API_KEY राख्नुपर्छ)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

let cache = { data: null, last_updated: null };


// ==========================================================
// 🟢 DYNAMIC NEPALI DATE FUNCTION
// ==========================================================
// IMPORTANT:
// राशिफलको date बिहान ४ बजे परिवर्तन हुन्छ।
// राति १२ बजे परिवर्तन हुँदैन।
//
// उदाहरण:
// 2026-09-03 बिहान 3:59 सम्म → अघिल्लो दिनको BS date
// 2026-09-03 बिहान 4:00 पछि → 2083 भदौ 18
//
// English date (date_en) पनि यही 4 AM cutoff अनुसार
// अघिल्लो दिन / current day हुन्छ।
// ==========================================================

function getNepaliDateText() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const hour = nepalNow.hour();

  // बिहान ४ बजेभन्दा अगाडि भए अघिल्लो दिनलाई target बनाउने
  let targetMoment = nepalNow.clone();

  if (hour < 4) {
    targetMoment = targetMoment.subtract(1, "day");
  }

  // Target AD date
  const dateEn = targetMoment.format("YYYY-MM-DD");

  // AD → BS conversion
  const bsDate = adToBs(dateEn);

  // Package बाट आएको BS date सामान्यतया YYYY-MM-DD format मा आउँछ।
  // Future compatibility का लागि string/object दुवैलाई safely handle गरिएको छ।
  let bsYear;
  let bsMonth;
  let bsDay;

  if (typeof bsDate === "string") {
    const parts = bsDate.split("-");

    bsYear = parseInt(parts[0], 10);
    bsMonth = parseInt(parts[1], 10);
    bsDay = parseInt(parts[2], 10);
  } else if (bsDate && typeof bsDate === "object") {
    bsYear = Number(bsDate.year);
    bsMonth = Number(bsDate.month);
    bsDay = Number(bsDate.day ?? bsDate.date);
  } else {
    throw new Error(`Invalid BS date returned for AD date: ${dateEn}`);
  }

  // Nepali month names
  const nepaliMonths = [
    "",
    "बैशाख",
    "जेठ",
    "असार",
    "श्रावण",
    "भदौ",
    "असोज",
    "कार्तिक",
    "मंसिर",
    "पौष",
    "माघ",
    "फागुन",
    "चैत"
  ];

  // Nepali weekday names
  // moment().day(): Sunday = 0 ... Saturday = 6
  const nepaliWeekdays = [
    "आइतबार",
    "सोमबार",
    "मङ्गलबार",
    "बुधबार",
    "बिहीबार",
    "शुक्रबार",
    "शनिबार"
  ];

  // Nepali Unicode digits
  const nepaliDigits = {
    "0": "०",
    "1": "१",
    "2": "२",
    "3": "३",
    "4": "४",
    "5": "५",
    "6": "६",
    "7": "७",
    "8": "८",
    "9": "९"
  };

  function toNepaliDigits(value) {
    return String(value).replace(
      /\d/g,
      (digit) => nepaliDigits[digit]
    );
  }

  const monthName = nepaliMonths[bsMonth];

  if (!monthName) {
    throw new Error(
      `Invalid Nepali month returned: ${bsMonth} for AD date ${dateEn}`
    );
  }

  const dayName = nepaliWeekdays[targetMoment.day()];

  // Same existing format:
  // भदौ १८ बिहीबार २०८३
  const dateNp =
    `${monthName} ${toNepaliDigits(bsDay)} ` +
    `${dayName} ${toNepaliDigits(bsYear)}`;

  console.log(
    `📅 [DATE DEBUG] AD: ${dateEn} → BS: ${dateNp}`
  );

  return {
    date_en: dateEn,
    day: dayName,
    date_np: dateNp
  };
}


// ==========================================================
// RANDOM DELAY
// ==========================================================

const randomDelay = (min = 5000, max = 10000) => {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
};


// ==========================================================
// SCRAPE WITH RETRY
// ==========================================================

async function scrapeWithRetry(url, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`🔍 [प्रयास ${attempt}/3] ${name} बाट डाटा तान्दै...`);

      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9,ne;q=0.8"
        },
        timeout: 15000
      });

      const $ = cheerio.load(data);
      let scrapedText = "";

      const targetElement = $(
        ".desc, .rashifal-content, .panel-body, article"
      ).first();

      if (targetElement.length > 0) {
        scrapedText = targetElement.text();
      } else {
        $("p").each((i, el) => {
          scrapedText += $(el).text() + "\n";
        });
      }

      if (scrapedText.length > 200) {
        console.log(
          `✅ ${name} बाट सफलतापूर्वक डाटा प्राप्त भयो!`
        );

        return {
          success: true,
          text: scrapedText
        };
      }
    } catch (err) {
      console.warn(
        `⚠️ ${name} प्रयास ${attempt} असफल: ${err.message}`
      );

      if (attempt < 3) {
        await randomDelay(5000, 10000);
      }
    }
  }

  return {
    success: false,
    text: null
  };
}


// ==========================================================
// FETCH RAW DATA
// ==========================================================

async function fetchRawData() {
  let result = await scrapeWithRetry(
    "https://www.hamropatro.com/rashifal",
    "हाम्रो पात्रो"
  );

  if (result.success) {
    return {
      data: result.text,
      source: "HamroPatro"
    };
  }

  console.log(
    "⚠️ 'हाम्रो पात्रो' मा प्रयास असफल, 'नेपाली पात्रो' मा जाँदैछ..."
  );

  await randomDelay(5000, 10000);

  let backupResult = await scrapeWithRetry(
    "https://nepalipatro.com.np/nepali-rashifal",
    "नेपाली पात्रो"
  );

  if (backupResult.success) {
    return {
      data: backupResult.text,
      source: "NepaliPatro"
    };
  }

  return {
    data: null,
    source: "None"
  };
}


// ==========================================================
// GEMINI MODELS
// ==========================================================

const AVAILABLE_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash"
];


// ==========================================================
// GEMINI AI
// ==========================================================

async function callGeminiAI(promptText) {
  for (const modelName of AVAILABLE_MODELS) {
    try {
      console.log(
        `🤖 Google Gemini (${modelName}) प्रयोग गर्दै...`
      );

      const response = await ai.models.generateContent({
        model: modelName,
        contents: promptText,
      });

      if (response && response.text) {
        console.log(
          `✅ ${modelName} बाट सफलतापूर्वक नतिजा आयो!`
        );

        return response.text;
      }
    } catch (err) {
      console.warn(
        `⚠️ मोडल ${modelName} मा समस्या देखियो: ${err.message}`
      );

      console.log(
        `🔄 अर्को लाइभ मोडलमा तुरुन्त जाँदैछ...`
      );

      await new Promise(resolve =>
        setTimeout(resolve, 2000)
      );
    }
  }

  throw new Error(
    "❌ सबै गुगल जेमिनी मोडलहरू पूर्ण रूपमा असफल भए!"
  );
}


// ==========================================================
// PROCESS AND GENERATE
// ==========================================================

async function processAndGenerate(
  rawContent,
  dateEn,
  dayName,
  dateNp,
  sourceUsed
) {
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "❌ ERROR: GEMINI_API_KEY is missing in environment variables!"
    );

    return false;
  }

  let statusMessage =
    sourceUsed !== "None" ? "" : "Loading...";

  const prompt = `You are a professional Nepali content localizer. Your task is to rewrite the provided raw horoscope text into simple, natural, conversational Nepali (जसरी साथीसँग चिया खाँदै गफ गरिन्छ).

📌 Raw Scraped Data:
${rawContent ? rawContent.substring(0, 8000) : "Daily Horoscope"}

✅ Strict Rules for the Nepali Output:
1. **Do not change the core astrological meaning or predictions of the original text.** Translate and adapt the exact points provided in the raw data into natural spoken Nepali without adding imaginary predictions.
2. **Each zodiac sign must have EXACTLY 4 sentences.**
3. Use everyday spoken words, avoid heavy or official Sanskrit words.
4. Never include the zodiac sign's name inside the prediction text or at the beginning.
5. Do not start sentences with phrases like "आजको दिन" वा "यस दिन".
6. Never include lucky colors, lucky numbers, lucky directions, or gemstone details inside the prediction.
7. Use this EXACT Nepali date string provided without changing it: "${dateNp}".
8. Do not add imaginative details, extra adjectives, or extended storytelling. Keep it crisp, faithful, and direct to the original text while using natural spoken Nepali.

Return ONLY a valid JSON object matching this exact structure:
{
  "date_np": "${dateNp}",
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
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "पहिलो वाक्य। दोस्रो वाक्य। तेस्रो वाक्य। चौथो वाक्य."}
  ]
}

⚡ CRITICAL: Do not include any extra markdown or text, only output valid JSON.`;

  try {
    const content = await callGeminiAI(prompt);

    const cleanJson = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    cache = {
      data: JSON.parse(cleanJson),
      last_updated: new Date().toISOString()
    };

    console.log(
      "✅ Success! जेमिनीबाट सफलतापूर्वक अनुवाद र राशिफल तयार भयो।"
    );

    return true;
  } catch (err) {
    console.error(
      "❌ Gemini AI Processing Failed:",
      err.message
    );

    return false;
  }
}


// ==========================================================
// WORKFLOW
// ==========================================================

async function runWorkflow() {
  const {
    date_en,
    day,
    date_np
  } = getNepaliDateText();

  console.log(
    `🚀 ${date_en} (${day}) को लागि राशिफल वर्कफ्लो सुरु हुँदैछ...`
  );

  const {
    data: rawData,
    source
  } = await fetchRawData();

  return await processAndGenerate(
    rawData,
    date_en,
    day,
    date_np,
    source
  );
}


// ==========================================================
// CRON — EVERY DAY AT 4:00 AM NEPAL TIME
// ==========================================================

cron.schedule(
  "0 4 * * *",
  () => {
    runWorkflow();
  },
  {
    scheduled: true,
    timezone: "Asia/Kathmandu"
  }
);


// ==========================================================
// RASIFAL API
// ==========================================================

app.get("/api/rasifal", (req, res) => {
  if (!cache.data) {
    return res.status(503).json({
      status: "error",
      message:
        "आजको राशिफल केही technical problem ले उपलब्ध हुन सकेन, कृपया केही समय पछाडि try गर्नुहोस्।"
    });
  }

  res.json(cache.data);
});


// ==========================================================
// MANUAL GENERATE API
// ==========================================================

app.get("/api/generate-now", async (req, res, next) => {
  const success = await runWorkflow();

  if (success) {
    res.json({
      status: "success",
      message: "सफलतापूर्वक जेनेरेट भयो!",
      data: cache.data
    });
  } else {
    res.status(500).json({
      status: "error",
      message:
        "आजको राशिफल केही technical problem ले उपलब्ध हुन सकेन, कृपया केही समय पछाडि try गर्नुहोस्।"
    });
  }
});


// ==========================================================
// FUEL RATE ROUTER
// ==========================================================

const fuelRateRouter = require("./fuelRate");

app.use("/api", fuelRateRouter);


// ==========================================================
// START SERVER
// ==========================================================

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  if (!cache.data) {
    await runWorkflow();
  }
});
