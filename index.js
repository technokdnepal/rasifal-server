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

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

let cache = {
  data: null,
  last_updated: null
};

let lastLoggedDateDebug = null;

// ==========================================================
// NEPALI DATE
// ==========================================================

function getNepaliDateText() {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const hour = nepalNow.hour();

  let targetMoment = nepalNow.clone();

  if (hour < 4) {
    targetMoment = targetMoment.subtract(1, "day");
  }

  const dateEn = targetMoment.format("YYYY-MM-DD");
  const bsDate = adToBs(dateEn);

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
    throw new Error(
      `Invalid BS date returned for AD date: ${dateEn}`
    );
  }

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

  const nepaliWeekdays = [
    "आइतबार",
    "सोमबार",
    "मङ्गलबार",
    "बुधबार",
    "बिहीबार",
    "शुक्रबार",
    "शनिबार"
  ];

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

  const dateNp =
    `${monthName} ${toNepaliDigits(bsDay)} ` +
    `${dayName} ${toNepaliDigits(bsYear)}`;

  // Same date → log only once.
  // New date → log once again.
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
  const ms =
    Math.floor(Math.random() * (max - min + 1)) + min;

  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
};

// ==========================================================
// SCRAPE WITH RETRY
// ==========================================================

async function scrapeWithRetry(url, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(
        `🔍 [प्रयास ${attempt}/3] ${name} बाट डाटा तान्दै...`
      );

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
  const result = await scrapeWithRetry(
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

  const backupResult = await scrapeWithRetry(
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
        contents: promptText
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
        "🔄 अर्को लाइभ मोडलमा तुरुन्त जाँदैछ..."
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

  const statusMessage =
    sourceUsed !== "None" ? "" : "Loading...";

  try {
    // ========================================================
    // STEP 1: NEPALI SOURCE → ENGLISH
    // ========================================================

    console.log(
      `🌐 Step 1: ${sourceUsed} को raw horoscope लाई English मा translate गर्दै...`
    );

    const translationPrompt = `
You are a professional translator.

Translate the following scraped Nepali horoscope into clear,
accurate English.

IMPORTANT:
- Translate the meaning faithfully.
- Do not summarize.
- Do not add information.
- Do not remove important information.
- Preserve the information for each zodiac sign.
- This is ONLY an intermediate translation step.
- Do not create a new horoscope yet.

RAW NEPALI HOROSCOPE:
${rawContent ? rawContent.substring(0, 8000) : "Daily Horoscope"}

Return ONLY the English translation.
Do not add explanations, markdown, headings, or comments.
`;

    const englishSource =
      await callGeminiAI(translationPrompt);

    if (
      !englishSource ||
      englishSource.trim().length < 100
    ) {
      throw new Error(
        "English intermediate translation was empty or too short."
      );
    }

    console.log(
      "✅ Step 1 complete: English intermediate data तयार भयो।"
    );

    // ========================================================
    // STEP 2: ENGLISH MEANING → FRESH NEPALI
    // ========================================================

    console.log(
      "🧠 Step 2: English meaning बाट नयाँ Nepali Rashifal तयार गर्दै..."
    );

    const generationPrompt = `
You are an original Nepali horoscope content writer.

The text below is an ENGLISH INTERMEDIATE TRANSLATION of horoscope
information from another source.

Create a completely fresh and independently written Nepali horoscope
based only on the general astrological themes contained in that
English information.

This is NOT a direct translation task.

ORIGINALITY RULES:
1. Do not copy any sentence from the source.
2. Do not closely rewrite source sentences.
3. Do not preserve the source sentence order.
4. Do not preserve source wording or phrasing.
5. Do not translate the English sentences directly into Nepali.
6. Reorganize the ideas naturally.
7. Use different sentence structures and expressions.
8. Write as if the Nepali horoscope was independently written.
9. Do not mention the source, website, translation, English text,
   or AI.
10. Do not add specific facts or events that are not supported by
    the general themes.

STYLE:
- Simple, natural, conversational Nepali.
- Easy for ordinary Nepali readers.
- Avoid heavy Sanskrit/official words.
- EXACTLY 4 sentences per zodiac sign.
- Keep predictions concise.
- Do not put the zodiac sign name inside the prediction.
- Do not start with "आजको दिन" or "यस दिन".
- Do not include lucky colors, numbers, directions, gemstones,
  or similar details.
- Avoid repetitive sentence patterns between signs.

DATE:
Use exactly:
"${dateNp}"

ENGLISH INTERMEDIATE INFORMATION:
${englishSource.substring(0, 12000)}

Return ONLY this JSON structure:

{
  "date_np": "${dateNp}",
  "date": "${dateEn}",
  "day": "${dayName}",
  "status_message": "${statusMessage}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"}
  ]
}

CRITICAL:
Return ONLY valid JSON.
No markdown.
No explanation.
`;

    const content =
      await callGeminiAI(generationPrompt);

    const cleanJson = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const generatedData = JSON.parse(cleanJson);

    // ========================================================
    // VALIDATION
    // ========================================================

    if (
      !generatedData ||
      generatedData.date !== dateEn ||
      !Array.isArray(generatedData.data) ||
      generatedData.data.length !== 12
    ) {
      throw new Error(
        "Gemini returned invalid Rashifal structure."
      );
    }

    for (const item of generatedData.data) {
      if (
        !item.sign ||
        !item.sign_np ||
        !item.prediction
      ) {
        throw new Error(
          "Gemini returned incomplete zodiac data."
        );
      }
    }

    cache = {
      data: generatedData,
      last_updated: new Date().toISOString()
    };

    console.log(
      "✅ Success! English intermediate translation हुँदै fresh Nepali Rashifal तयार भयो र cache update भयो।"
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

app.get("/api/generate-now", async (req, res) => {
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
  console.log(
    `🚀 Server running on port ${PORT}`
  );

  if (!cache.data) {
    await runWorkflow();
  }
});
