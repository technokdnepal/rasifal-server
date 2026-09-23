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

// Prevent overlapping Rashifal workflows
let workflowRunning = false;

// Prevent repeated DATE DEBUG logs for the same date
let lastLoggedDateDebug = null;


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
// अघिल्लो दिन / current day हुन्छ.
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

  // Log the date only once for each target date.
  // This does NOT affect date calculation or any server logic.
  if (lastLoggedDateDebug !== dateEn) {
    console.log(
      `📅 [DATE DEBUG] AD: ${dateEn} → BS: ${dateNp}`
    );

    lastLoggedDateDebug = dateEn;
  }

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
// GEMINI MODEL DISCOVERY + RETRY
// ==========================================================

// Retry schedule:
// 5 sec → 10 sec → 20 sec → 30 sec → 40 sec → 60 sec
// After that, continue every 60 seconds until successful.
const GEMINI_RETRY_DELAYS = [
  5000,
  10000,
  20000,
  30000,
  40000,
  60000
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ----------------------------------------------------------
// Extract HTTP/status information safely
// ----------------------------------------------------------

function getGeminiErrorInfo(err) {
  let status =
    err?.status ??
    err?.code ??
    err?.response?.status ??
    null;

  let message = err?.message || String(err);

  // Sometimes SDK puts the actual JSON error inside message
  try {
    const parsed = JSON.parse(message);

    if (parsed?.error) {
      status = parsed.error.code ?? status;
      message = parsed.error.message || message;
    }
  } catch (_) {
    // Ignore JSON parse failure
  }

  return {
    status: Number(status) || null,
    message
  };
}


// ----------------------------------------------------------
// Permanent model errors
// ----------------------------------------------------------
// These should NOT be retried forever.
//
// 404 = model not found / unsupported
// 400 = invalid model/request
// 401 = invalid authentication
// 403 = permission / blocked / unavailable for this key
// ----------------------------------------------------------

function isPermanentGeminiError(err) {
  const { status, message } = getGeminiErrorInfo(err);

  if ([400, 401, 403, 404].includes(status)) {
    return true;
  }

  const text = message.toLowerCase();

  return (
    text.includes("not found") ||
    text.includes("no longer available") ||
    text.includes("not supported") ||
    text.includes("unsupported model") ||
    text.includes("deprecated") ||
    text.includes("invalid model")
  );
}


// ----------------------------------------------------------
// Temporary Gemini errors
// ----------------------------------------------------------
// 429 = rate limit / quota pressure
// 500/502/503/504 = temporary server-side problems
// ----------------------------------------------------------

function isRetryableGeminiError(err) {
  const { status, message } = getGeminiErrorInfo(err);

  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const text = message.toLowerCase();

  return (
    text.includes("high demand") ||
    text.includes("temporarily unavailable") ||
    text.includes("service unavailable") ||
    text.includes("rate limit") ||
    text.includes("quota") ||
    text.includes("try again later")
  );
}


// ----------------------------------------------------------
// Discover currently available Gemini Flash models
// ----------------------------------------------------------

async function getAvailableGeminiModels() {
  console.log(
    "🔎 Google Gemini बाट अहिले उपलब्ध models खोज्दै..."
  );

  const pager = await ai.models.list({
    config: {
      pageSize: 100
    }
  });

  const discovered = [];

  for await (const model of pager) {
    const name =
      model?.baseModelId ||
      (model?.name ? model.name.replace(/^models\//, "") : "");

    if (!name) {
      continue;
    }

    const lowerName = name.toLowerCase();

    const supportedMethods =
      model?.supportedGenerationMethods ||
      model?.supportedActions ||
      [];

    const supportsGenerateContent =
      supportedMethods.includes("generateContent");

    // Only Gemini Flash text-generation models.
    // Preview/experimental/live/image/embedding models are excluded.
    const isGeminiFlash =
      lowerName.startsWith("gemini-") &&
      lowerName.includes("flash");

    const isUnstableVariant =
      lowerName.includes("preview") ||
      lowerName.includes("experimental") ||
      lowerName.includes("-exp") ||
      lowerName.includes("-live") ||
      lowerName.includes("image") ||
      lowerName.includes("embedding") ||
      lowerName.includes("tts");

    if (
      isGeminiFlash &&
      supportsGenerateContent &&
      !isUnstableVariant
    ) {
      discovered.push({
        id: name,
        displayName: model?.displayName || name,
        version: model?.version || ""
      });
    }
  }

  // Remove duplicates
  const uniqueModels = [];
  const seen = new Set();

  for (const model of discovered) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      uniqueModels.push(model);
    }
  }

  // Prefer normal Flash over Flash-Lite.
  // Then prefer higher numeric Gemini versions.
  uniqueModels.sort((a, b) => {
    const aLite = a.id.toLowerCase().includes("flash-lite");
    const bLite = b.id.toLowerCase().includes("flash-lite");

    if (aLite !== bLite) {
      return aLite ? 1 : -1;
    }

    const aNumbers = (
      a.id.match(/gemini-(\d+(?:\.\d+)?)/i)?.[1] || "0"
    );

    const bNumbers = (
      b.id.match(/gemini-(\d+(?:\.\d+)?)/i)?.[1] || "0"
    );

    return Number(bNumbers) - Number(aNumbers);
  });

  console.log(
    `✅ ${uniqueModels.length} वटा usable Gemini Flash models भेटिए:`
  );

  uniqueModels.forEach((model, index) => {
    console.log(
      `   ${index + 1}. ${model.id}`
    );
  });

  return uniqueModels;
}


// ----------------------------------------------------------
// Parse and validate Gemini JSON
// ----------------------------------------------------------

function parseAndValidateGeminiResult(content, expectedDate) {
  const cleanJson = content
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const parsed = JSON.parse(cleanJson);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Gemini returned invalid JSON object.");
  }

  if (parsed.date !== expectedDate) {
    throw new Error(
      `Gemini returned wrong date. Expected ${expectedDate}, got ${parsed.date}`
    );
  }

  if (!Array.isArray(parsed.data) || parsed.data.length !== 12) {
    throw new Error(
      "Gemini returned invalid zodiac data. Exactly 12 signs are required."
    );
  }

  for (const item of parsed.data) {
    if (
      !item ||
      typeof item.sign !== "string" ||
      typeof item.sign_np !== "string" ||
      typeof item.prediction !== "string" ||
      !item.prediction.trim()
    ) {
      throw new Error(
        "Gemini returned incomplete zodiac prediction data."
      );
    }
  }

  return parsed;
}


// ----------------------------------------------------------
// Generate using one model
// ----------------------------------------------------------

async function generateWithSingleModel(
  modelName,
  promptText,
  expectedDate
) {
  console.log(
    `🤖 Google Gemini (${modelName}) प्रयोग गर्दै...`
  );

  const response = await ai.models.generateContent({
    model: modelName,
    contents: promptText,
  });

  if (!response || !response.text) {
    throw new Error(
      `${modelName} returned an empty response.`
    );
  }

  const parsed = parseAndValidateGeminiResult(
    response.text,
    expectedDate
  );

  console.log(
    `✅ ${modelName} बाट valid Rashifal सफलतापूर्वक तयार भयो!`
  );

  return parsed;
}


// ----------------------------------------------------------
// GEMINI AI WITH DYNAMIC MODEL FAILOVER + RETRY
// ----------------------------------------------------------

async function callGeminiAI(promptText, expectedDate) {
  let retryModels = [];
  let delayIndex = 0;

  while (true) {
    let availableModels;

    try {
      availableModels = await getAvailableGeminiModels();
    } catch (err) {
      console.error(
        `❌ Gemini models list गर्न समस्या: ${err.message}`
      );

      const delay =
        GEMINI_RETRY_DELAYS[
          Math.min(
            delayIndex,
            GEMINI_RETRY_DELAYS.length - 1
          )
        ];

      console.log(
        `🔄 ${delay / 1000} sec पछि models फेरि खोजिँदैछ...`
      );

      await sleep(delay);

      if (
        delayIndex <
        GEMINI_RETRY_DELAYS.length - 1
      ) {
        delayIndex++;
      }

      continue;
    }

    if (!availableModels.length) {
      console.error(
        "❌ अहिले कुनै usable Gemini Flash model उपलब्ध छैन।"
      );

      const delay =
        GEMINI_RETRY_DELAYS[
          Math.min(
            delayIndex,
            GEMINI_RETRY_DELAYS.length - 1
          )
        ];

      console.log(
        `🔄 ${delay / 1000} sec पछि फेरि उपलब्ध models खोजिँदैछ...`
      );

      await sleep(delay);

      if (
        delayIndex <
        GEMINI_RETRY_DELAYS.length - 1
      ) {
        delayIndex++;
      }

      continue;
    }

    // ------------------------------------------------------
    // FIRST PASS:
    // प्रत्येक available model एकपटक try गर्ने।
    // Temporary/high-demand भए retry queue मा राख्ने।
    // Unsupported/permanent भए skip गर्ने।
    // ------------------------------------------------------

    retryModels = [];

    for (const model of availableModels) {
      try {
        const result = await generateWithSingleModel(
          model.id,
          promptText,
          expectedDate
        );

        return result;

      } catch (err) {
        const { status, message } =
          getGeminiErrorInfo(err);

        console.warn(
          `⚠️ मोडल ${model.id} असफल भयो: ${message}`
        );

        if (isPermanentGeminiError(err)) {
          console.warn(
            `⏭️ ${model.id} unsupported/deprecated/blocked जस्तो देखियो। यो model skip गरिँदैछ।`
          );

          continue;
        }

        if (isRetryableGeminiError(err)) {
          console.log(
            `⏳ ${model.id} temporary/high-demand समस्या हो। Retry queue मा राखियो।`
          );

          retryModels.push(model);
          continue;
        }

        // Unknown generation error:
        // अर्को model मा जान्छौं, तर retry queue मा पनि राख्छौं।
        console.log(
          `🔄 ${model.id} मा unknown temporary error देखियो। Retry queue मा राखियो।`
        );

        retryModels.push(model);
      }
    }

    // ------------------------------------------------------
    // ALL MODELS FAILED:
    // अब retry loop सुरु हुन्छ।
    // 5s → 10s → 20s → 30s → 40s → 60s
    // त्यसपछि हरेक 60s मा continue.
    // ------------------------------------------------------

    if (!retryModels.length) {
      console.log(
        "⚠️ पहिलो pass मा retry गर्न मिल्ने model भेटिएन। नयाँ models फेरि खोजिँदैछ..."
      );

      const delay =
        GEMINI_RETRY_DELAYS[
          Math.min(
            delayIndex,
            GEMINI_RETRY_DELAYS.length - 1
          )
        ];

      await sleep(delay);

      if (
        delayIndex <
        GEMINI_RETRY_DELAYS.length - 1
      ) {
        delayIndex++;
      }

      continue;
    }

    const retryDelay =
      GEMINI_RETRY_DELAYS[
        Math.min(
          delayIndex,
          GEMINI_RETRY_DELAYS.length - 1
        )
      ];

    console.log(
      `⏳ सबै available models temporary fail भए। ${retryDelay / 1000} sec पछि retry सुरु हुँदैछ...`
    );

    await sleep(retryDelay);

    if (
      delayIndex <
      GEMINI_RETRY_DELAYS.length - 1
    ) {
      delayIndex++;
    }

    // ------------------------------------------------------
    // RETRY PASS:
    // High-demand/temporary-failed models फेरि try गर्ने।
    // सफल नभएसम्म loop जारी रहन्छ।
    // ------------------------------------------------------

    const stillRetryable = [];

    for (const model of retryModels) {
      try {
        const result = await generateWithSingleModel(
          model.id,
          promptText,
          expectedDate
        );

        return result;

      } catch (err) {
        const { message } =
          getGeminiErrorInfo(err);

        console.warn(
          `⚠️ Retry मा ${model.id} फेरि असफल: ${message}`
        );

        if (isPermanentGeminiError(err)) {
          console.warn(
            `⏭️ ${model.id} अब unsupported/deprecated/blocked देखियो। Retry list बाट हटाइयो।`
          );

          continue;
        }

        stillRetryable.push(model);
      }
    }

    // ------------------------------------------------------
    // Retry पछि सबै fail भए:
    // अर्को loop मा Google बाट fresh model list फेरि detect हुन्छ।
    // ------------------------------------------------------

    retryModels = stillRetryable;

    if (!retryModels.length) {
      console.log(
        "🔄 Retry list खाली भयो। Google बाट नयाँ available models फेरि detect गरिँदैछ..."
      );
    } else {
      console.log(
        `🔁 ${retryModels.length} वटा model अझै retry गर्न बाँकी छन्।`
      );
    }
  }
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
    const generatedData = await callGeminiAI(
      prompt,
      dateEn
    );

    // IMPORTANT:
    // Cache is updated ONLY after successful valid generation.
    cache = {
      data: generatedData,
      last_updated: new Date().toISOString()
    };

    console.log(
      `✅ Success! ${dateEn} को राशिफल सफलतापूर्वक generate भयो र cache update भयो।`
    );

    return true;

  } catch (err) {
    console.error(
      "❌ Gemini AI Processing Failed:",
      err.message
    );

    // IMPORTANT:
    // Do NOT restore old cache here.
    // Old-date Rashifal must never be shown as today's Rashifal.
    return false;
  }
}


// ==========================================================
// WORKFLOW
// ==========================================================

async function runWorkflow() {
  if (workflowRunning) {
    console.log(
      "⚠️ Rashifal workflow already running. अर्को workflow सुरु गरिँदैन।"
    );

    return false;
  }

  workflowRunning = true;

  try {
    const {
      date_en,
      day,
      date_np
    } = getNepaliDateText();

    console.log(
      `🚀 ${date_en} (${day}) को लागि राशिफल वर्कफ्लो सुरु हुँदैछ...`
    );

    // IMPORTANT:
    // New-day generation starts with NO visible old cache.
    // This prevents yesterday's Rashifal from being shown today.
    cache = {
      data: null,
      last_updated: null
    };

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

  } catch (err) {
    console.error(
      "❌ Rashifal workflow failed:",
      err.message
    );

    // Never keep/show old-date data after a failed new-day workflow.
    cache = {
      data: null,
      last_updated: null
    };

    return false;

  } finally {
    workflowRunning = false;
  }
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
  const {
    date_en: currentDate
  } = getNepaliDateText();

  // No cache = today's Rashifal is not ready.
  if (!cache.data) {
    return res.status(503).json({
      status: "error",
      message:
        "आजको राशिफल उपलब्ध छैन। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।"
    });
  }

  // IMPORTANT:
  // Never return yesterday/old-date Rashifal.
  if (cache.data.date !== currentDate) {
    return res.status(503).json({
      status: "error",
      message:
        "आजको राशिफल उपलब्ध छैन। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।"
    });
  }

  res.json(cache.data);
});


// ==========================================================
// MANUAL GENERATE API
// ==========================================================

app.get("/api/generate-now", async (req, res, next) => {
  if (workflowRunning) {
    return res.status(409).json({
      status: "error",
      message:
        "राशिफल अहिले generate हुँदैछ। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।"
    });
  }

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
