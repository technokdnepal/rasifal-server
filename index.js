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

// Prevent overlapping Rashifal workflows
let workflowRunning = false;

// ==========================================================
// DYNAMIC NEPALI DATE FUNCTION
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

  return new Promise(resolve => setTimeout(resolve, ms));
};

// ==========================================================
// SCRAPE WITH RETRY
// ==========================================================
async function scrapeWithRetry(url, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(
        `🔍 [SCRAPE ${attempt}/3] ${name} बाट Rashifal data तान्दै...`
      );

      const { data } = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept-Language":
            "en-US,en;q=0.9,ne;q=0.8"
        },
        timeout: 15000
      });

      const $ = cheerio.load(data);

      let scrapedText = "";

      // ------------------------------------------------------
      // First try the known Rashifal containers.
      // ------------------------------------------------------
      const targetElement = $(
        ".desc, .rashifal-content, .panel-body, article"
      ).first();

      if (targetElement.length > 0) {
        scrapedText = targetElement.text().trim();
      }

      // ------------------------------------------------------
      // If the selected container is missing or too short,
      // collect paragraph text as a fallback within the same
      // source attempt.
      // ------------------------------------------------------
      if (scrapedText.length <= 200) {
        let paragraphText = "";

        $("p").each((i, el) => {
          const text = $(el).text().trim();

          if (text) {
            paragraphText += text + "\n";
          }
        });

        if (paragraphText.length > scrapedText.length) {
          scrapedText = paragraphText.trim();
        }
      }

      if (scrapedText.length > 200) {
        console.log(
          `✅ [SOURCE SUCCESS] ${name} बाट Rashifal data सफलतापूर्वक प्राप्त भयो।`
        );

        return {
          success: true,
          text: scrapedText
        };
      }

      console.warn(
        `⚠️ [SOURCE EMPTY] ${name} बाट पर्याप्त Rashifal data भेटिएन।`
      );

    } catch (err) {
      console.warn(
        `⚠️ [SCRAPE FAIL] ${name} प्रयास ${attempt}/3 असफल: ${err.message}`
      );
    }

    if (attempt < 3) {
      await randomDelay(5000, 10000);
    }
  }

  console.error(
    `❌ [SOURCE FAILED] ${name} बाट 3 वटै प्रयास असफल भयो।`
  );

  return {
    success: false,
    text: null
  };
}

// ==========================================================
// FETCH RAW DATA
// ==========================================================
async function fetchRawData() {
  console.log(
    "📰 [SOURCE] पहिले HamroPatro बाट Rashifal data खोजिँदैछ..."
  );

  const result = await scrapeWithRetry(
    "https://www.hamropatro.com/rashifal",
    "हाम्रो पात्रो"
  );

  if (result.success) {
    console.log(
      "🟢 [SOURCE SELECTED] HamroPatro प्रयोग हुँदैछ।"
    );

    return {
      data: result.text,
      source: "HamroPatro"
    };
  }

  console.warn(
    "🔴 [SOURCE FALLBACK] HamroPatro का सबै प्रयास असफल भए। अब NepaliPatro मा fallback हुँदैछ..."
  );

  await randomDelay(5000, 10000);

  console.log(
    "📰 [SOURCE] NepaliPatro बाट Rashifal data खोजिँदैछ..."
  );

  const backupResult = await scrapeWithRetry(
    "https://nepalipatro.com.np/nepali-rashifal",
    "नेपाली पात्रो"
  );

  if (backupResult.success) {
    console.log(
      "🟢 [SOURCE SELECTED] NepaliPatro fallback रूपमा प्रयोग हुँदैछ।"
    );

    return {
      data: backupResult.text,
      source: "NepaliPatro"
    };
  }

  console.error(
    "🔴 [SOURCE FAILED] HamroPatro र NepaliPatro दुवैबाट Rashifal data प्राप्त भएन।"
  );

  return {
    data: null,
    source: "None"
  };
}

// ==========================================================
// GEMINI CONTROLLED RETRY SETTINGS
// ==========================================================

// IMPORTANT:
// This is intentionally FINITE.
//
// Maximum per Gemini stage:
// - Initial pass: up to 5 different usable models
// - Controlled retry pass: only temporary-failure models
// - Maximum 2 passes
//
// There is NO infinite retry loop.
const GEMINI_MAX_MODELS_PER_PASS = 5;
const GEMINI_MAX_PASSES = 2;

const GEMINI_RETRY_DELAYS = [
  5000,
  15000
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================================
// Extract HTTP/status/error information safely
// ==========================================================
function getGeminiErrorInfo(err) {
  let status =
    err?.status ??
    err?.code ??
    err?.response?.status ??
    null;

  let message =
    err?.message ||
    String(err);

  try {
    const parsed =
      JSON.parse(message);

    if (parsed?.error) {
      status =
        parsed.error.code ??
        status;

      message =
        parsed.error.message ||
        message;
    }
  } catch (_) {
    // Ignore JSON parse failure
  }

  const lowerMessage =
    message.toLowerCase();

  return {
    status: Number(status) || null,
    message,
    lowerMessage
  };
}

// ==========================================================
// Detect permanent / unusable Gemini errors
// ==========================================================
function isPermanentGeminiError(err) {
  const {
    status,
    lowerMessage
  } = getGeminiErrorInfo(err);

  if ([400, 401, 403, 404].includes(status)) {
    return true;
  }

  return (
    lowerMessage.includes("not found") ||
    lowerMessage.includes("no longer available") ||
    lowerMessage.includes("not supported") ||
    lowerMessage.includes("unsupported model") ||
    lowerMessage.includes("deprecated") ||
    lowerMessage.includes("invalid model") ||
    lowerMessage.includes("limit: 0")
  );
}

// ==========================================================
// Detect retryable temporary Gemini errors
// ==========================================================
function isRetryableGeminiError(err) {
  const {
    status,
    lowerMessage
  } = getGeminiErrorInfo(err);

  if ([429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  return (
    lowerMessage.includes("high demand") ||
    lowerMessage.includes("temporarily unavailable") ||
    lowerMessage.includes("service unavailable") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("try again later") ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("resource exhausted") ||
    lowerMessage.includes("quota exceeded")
  );
}

// ==========================================================
// Discover currently available Gemini Flash models
// ==========================================================
async function getAvailableGeminiModels() {
  console.log(
    "🔎 Google Gemini बाट अहिले उपलब्ध usable Flash models खोज्दै..."
  );

  const pager =
    await ai.models.list({
      config: {
        pageSize: 100
      }
    });

  const discovered = [];

  for await (const model of pager) {
    const name =
      model?.baseModelId ||
      (
        model?.name
          ? model.name.replace(
              /^models\//,
              ""
            )
          : ""
      );

    if (!name) {
      continue;
    }

    const lowerName =
      name.toLowerCase();

    const supportedMethods =
      model?.supportedGenerationMethods ||
      model?.supportedActions ||
      [];

    const supportsGenerateContent =
      supportedMethods.includes(
        "generateContent"
      );

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
        displayName:
          model?.displayName || name,
        version:
          model?.version || ""
      });
    }
  }

  const uniqueModels = [];
  const seen = new Set();

  for (const model of discovered) {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      uniqueModels.push(model);
    }
  }

  uniqueModels.sort((a, b) => {
    const aLite =
      a.id
        .toLowerCase()
        .includes("flash-lite");

    const bLite =
      b.id
        .toLowerCase()
        .includes("flash-lite");

    if (aLite !== bLite) {
      return aLite ? 1 : -1;
    }

    const aNumbers =
      a.id.match(
        /gemini-(\d+(?:\.\d+)?)/i
      )?.[1] || "0";

    const bNumbers =
      b.id.match(
        /gemini-(\d+(?:\.\d+)?)/i
      )?.[1] || "0";

    return (
      Number(bNumbers) -
      Number(aNumbers)
    );
  });

  console.log(
    `✅ ${uniqueModels.length} वटा usable Gemini Flash models भेटिए।`
  );

  uniqueModels.forEach(
    (model, index) => {
      console.log(
        `   ${index + 1}. ${model.id}`
      );
    }
  );

  return uniqueModels;
}

// ==========================================================
// PARSE GENERIC GEMINI JSON
// ==========================================================
function cleanGeminiJson(content) {
  return content
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
}

// ==========================================================
// VALIDATE ENGLISH INTERMEDIATE
// ==========================================================
function parseAndValidateEnglishIntermediate(
  content
) {
  const cleanJson =
    cleanGeminiJson(content);

  const parsed =
    JSON.parse(cleanJson);

  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    throw new Error(
      "Gemini returned invalid English intermediate JSON."
    );
  }

  if (
    !Array.isArray(parsed.data) ||
    parsed.data.length !== 12
  ) {
    throw new Error(
      "English intermediate must contain exactly 12 zodiac signs."
    );
  }

  for (const item of parsed.data) {
    if (
      !item ||
      typeof item.sign !== "string" ||
      typeof item.sign_np !== "string" ||
      typeof item.meaning !== "string" ||
      !item.meaning.trim()
    ) {
      throw new Error(
        "English intermediate contains incomplete zodiac data."
      );
    }
  }

  return parsed;
}

// ==========================================================
// VALIDATE FRESH HOROSCOPE IDEAS
// ==========================================================
function parseAndValidateFreshIdeas(
  content
) {
  const cleanJson =
    cleanGeminiJson(content);

  const parsed =
    JSON.parse(cleanJson);

  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    throw new Error(
      "Gemini returned invalid fresh-ideas JSON."
    );
  }

  if (
    !Array.isArray(parsed.data) ||
    parsed.data.length !== 12
  ) {
    throw new Error(
      "Fresh horoscope ideas must contain exactly 12 zodiac signs."
    );
  }

  for (const item of parsed.data) {
    if (
      !item ||
      typeof item.sign !== "string" ||
      typeof item.sign_np !== "string" ||
      !Array.isArray(item.angles) ||
      item.angles.length !== 4
    ) {
      throw new Error(
        "Fresh horoscope ideas must contain exactly 4 angles per zodiac sign."
      );
    }

    for (const angle of item.angles) {
      if (
        typeof angle !== "string" ||
        !angle.trim()
      ) {
        throw new Error(
          "Fresh horoscope angle is empty."
        );
      }
    }
  }

  return parsed;
}

// ==========================================================
// VALIDATE FINAL NEPALI RASHIFAL
// ==========================================================
function parseAndValidateGeminiResult(
  content,
  expectedDate
) {
  const cleanJson =
    cleanGeminiJson(content);

  const parsed =
    JSON.parse(cleanJson);

  if (
    !parsed ||
    typeof parsed !== "object"
  ) {
    throw new Error(
      "Gemini returned invalid JSON object."
    );
  }

  if (parsed.date !== expectedDate) {
    throw new Error(
      `Gemini returned wrong date. Expected ${expectedDate}, got ${parsed.date}`
    );
  }

  if (
    !Array.isArray(parsed.data) ||
    parsed.data.length !== 12
  ) {
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

    const sentences =
      item.prediction
        .split(/[।!?]+/)
        .map(
          s => s.trim()
        )
        .filter(Boolean);

    if (sentences.length !== 4) {
      throw new Error(
        `${item.sign_np} does not contain exactly 4 sentences. Got ${sentences.length}.`
      );
    }
  }

  return parsed;
}

// ==========================================================
// CONTROLLED GEMINI CALL
// ==========================================================
async function callGeminiWithValidator(
  promptText,
  validator,
  availableModels
) {
  if (
    !Array.isArray(availableModels) ||
    !availableModels.length
  ) {
    throw new Error(
      "No usable Gemini models are available."
    );
  }

  const candidateModels =
    availableModels.slice(
      0,
      Math.min(
        GEMINI_MAX_MODELS_PER_PASS,
        availableModels.length
      )
    );

  const failedTransientModels =
    new Set();

  for (
    let pass = 0;
    pass < GEMINI_MAX_PASSES;
    pass++
  ) {
    console.log(
      `🔄 Gemini pass ${pass + 1}/${GEMINI_MAX_PASSES} सुरु हुँदैछ...`
    );

    const modelsForThisPass =
      pass === 0
        ? candidateModels
        : candidateModels.filter(
            model =>
              failedTransientModels.has(
                model.id
              )
          );

    if (!modelsForThisPass.length) {
      console.log(
        "⚠️ Retry गर्न बाँकी temporary-failed model छैन।"
      );

      break;
    }

    for (const model of modelsForThisPass) {
      try {
        console.log(
          `🤖 Google Gemini (${model.id}) प्रयोग गर्दै...`
        );

        const response =
          await ai.models.generateContent({
            model: model.id,
            contents: promptText
          });

        if (
          !response ||
          !response.text
        ) {
          throw new Error(
            `${model.id} returned an empty response.`
          );
        }

        const parsed =
          validator(response.text);

        console.log(
          `✅ ${model.id} बाट valid response सफलतापूर्वक प्राप्त भयो!`
        );

        return parsed;

      } catch (err) {
        const {
          message
        } = getGeminiErrorInfo(err);

        console.warn(
          `⚠️ मोडल ${model.id} असफल भयो: ${message}`
        );

        // --------------------------------------------------
        // Permanent / unavailable model
        // --------------------------------------------------
        if (
          isPermanentGeminiError(err)
        ) {
          console.warn(
            `⏭️ ${model.id} permanently unusable/unavailable जस्तो देखियो। Retry गरिँदैन।`
          );

          failedTransientModels.delete(
            model.id
          );

          continue;
        }

        // --------------------------------------------------
        // Temporary model failure
        // --------------------------------------------------
        if (
          isRetryableGeminiError(err)
        ) {
          console.log(
            `⏳ ${model.id} temporary failure हो। Limited retry list मा राखियो।`
          );

          failedTransientModels.add(
            model.id
          );

          continue;
        }

        // --------------------------------------------------
        // Validation / unknown failure
        // --------------------------------------------------
        console.warn(
          `⏭️ ${model.id} बाट valid output आएन। यो request मा retry नगरी अर्को model मा जाँदैछ।`
        );

        failedTransientModels.delete(
          model.id
        );
      }
    }

    // No second pass
    if (
      pass >=
      GEMINI_MAX_PASSES - 1
    ) {
      break;
    }

    if (
      !failedTransientModels.size
    ) {
      break;
    }

    const delay =
      GEMINI_RETRY_DELAYS[
        Math.min(
          pass,
          GEMINI_RETRY_DELAYS.length - 1
        )
      ];

    console.log(
      `⏳ Temporary Gemini failures का कारण ${delay / 1000} sec पछि limited retry हुनेछ...`
    );

    await sleep(delay);
  }

  throw new Error(
    "Gemini generation failed after controlled attempts. No infinite retry will be performed."
  );
}

// ==========================================================
// TRANSLATE RAW NEPALI → ENGLISH SEMANTIC INTERMEDIATE
// ==========================================================
async function translateRawToEnglish(
  rawContent,
  availableModels
) {
  const translationPrompt = `You are the first semantic-analysis stage of a daily horoscope content pipeline.

The supplied text comes from a Nepali horoscope source.

Your task is NOT to write the final horoscope.

Your task is to understand the underlying meaning of the source and create a clean English semantic intermediate for a SECOND AI stage.

IMPORTANT:
- Do not produce final Nepali text.
- Do not copy the original sentence structure.
- Do not translate sentence-by-sentence.
- Do not preserve the original wording.
- Do not add predictions that are absent from the source.
- Preserve the broad astrological themes and useful meaning.
- Combine related ideas when appropriate.
- Ignore lucky colors, lucky numbers, lucky directions and gemstones.
- Exactly 12 zodiac signs are required.
- Keep the meaning concise.
- The next AI will use this semantic representation to create fresh horoscope ideas.
- This is a semantic abstraction, not a literal translation.

Raw source:
${rawContent.substring(0, 12000)}

Return ONLY valid JSON:

{
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Taurus",
      "sign_np": "वृष",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Gemini",
      "sign_np": "मिथुन",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Cancer",
      "sign_np": "कर्कट",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Leo",
      "sign_np": "सिंह",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Virgo",
      "sign_np": "कन्या",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Libra",
      "sign_np": "तुला",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Scorpio",
      "sign_np": "वृश्चिक",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Sagittarius",
      "sign_np": "धनु",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Capricorn",
      "sign_np": "मकर",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Aquarius",
      "sign_np": "कुम्भ",
      "meaning": "Concise English semantic meaning."
    },
    {
      "sign": "Pisces",
      "sign_np": "मीन",
      "meaning": "Concise English semantic meaning."
    }
  ]
}

Return nothing except the JSON object.`;

  return await callGeminiWithValidator(
    translationPrompt,
    parseAndValidateEnglishIntermediate,
    availableModels
  );
}

// ==========================================================
// CREATE FOUR FRESH HOROSCOPE IDEAS / ANGLES
// ==========================================================
async function createFreshHoroscopeIdeas(
  englishIntermediate,
  availableModels
) {
  const ideasPrompt = `You are the creative planning stage of a Nepali daily horoscope.

You are given an ENGLISH SEMANTIC INTERMEDIATE derived from source horoscope material.

Your job is to create FOUR fresh conversational horoscope ideas/angles for EACH zodiac sign.

This is NOT the final horoscope yet.

The four ideas should:
- Represent the underlying meaning from the semantic input.
- Be naturally reorganized rather than following the original source sentence order.
- Use different angles or perspectives where possible.
- Avoid sentence-by-sentence paraphrasing.
- Avoid repeating the same wording from the source.
- Avoid simply translating the English meaning back into Nepali.
- Keep the same broad astrological message.
- Never invent unrelated predictions.
- Do not include lucky colors, numbers, directions or gemstones.
- Do not mention the source.
- Do not mention AI, translation, scraping or rewriting.
- Each sign must have exactly FOUR distinct ideas.

Think about the overall message first, then create four independent conversational angles.

English semantic intermediate:
${JSON.stringify(
  englishIntermediate.data,
  null,
  2
)}

Return ONLY valid JSON:

{
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Taurus",
      "sign_np": "वृष",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Gemini",
      "sign_np": "मिथुन",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Cancer",
      "sign_np": "कर्कट",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Leo",
      "sign_np": "सिंह",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Virgo",
      "sign_np": "कन्या",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Libra",
      "sign_np": "तुला",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Scorpio",
      "sign_np": "वृश्चिक",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Sagittarius",
      "sign_np": "धनु",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Capricorn",
      "sign_np": "मकर",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Aquarius",
      "sign_np": "कुम्भ",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    },
    {
      "sign": "Pisces",
      "sign_np": "मीन",
      "angles": [
        "Fresh idea or angle one.",
        "Fresh idea or angle two.",
        "Fresh idea or angle three.",
        "Fresh idea or angle four."
      ]
    }
  ]
}

Return nothing except the JSON object.`;

  return await callGeminiWithValidator(
    ideasPrompt,
    parseAndValidateFreshIdeas,
    availableModels
  );
}

// ==========================================================
// GENERATE FINAL FRESH NEPALI FROM NEW IDEAS
// ==========================================================
async function generateFreshNepali(
  freshIdeas,
  dateEn,
  dayName,
  dateNp,
  availableModels
) {
  const generationPrompt = `You are an original Nepali horoscope writer.

You are given FOUR FRESH HOROSCOPE IDEAS for each zodiac sign.

Your task is to turn those ideas into a completely natural, original Nepali daily horoscope.

IMPORTANT:
- Do NOT translate the original source.
- Do NOT paraphrase the source sentence-by-sentence.
- Do NOT reconstruct the original source sentence order.
- The four supplied ideas have already been reorganized specifically to avoid source-like structure.
- Write the final text in your own natural Nepali wording.
- Use simple conversational Nepali.
- Make it sound like a human-written Nepali daily horoscope.
- Avoid heavy Sanskritized language.
- Do not use the zodiac sign name inside the prediction.
- Do not start with "आजको दिन" or "यस दिन".
- Do not mention HamroPatro, NepaliPatro, source, translation, scraping or AI.
- Do not use quotations.
- Do not add lucky colors, lucky numbers, lucky directions or gemstones.
- Do not invent unrelated predictions.
- Do not add details that are not supported by the provided ideas.
- Each zodiac sign MUST contain exactly 4 sentences.
- Each sentence should express one of the four ideas naturally.
- Do not copy the wording of the ideas literally.
- Vary sentence structure naturally.
- Avoid awkward mixed-language grammar.
- Use proper Nepali punctuation.

The goal is:

SOURCE MEANING
→ ENGLISH SEMANTIC UNDERSTANDING
→ FRESH HOROSCOPE IDEAS / ANGLES
→ ORIGINAL NATURAL NEPALI

The final result must NOT read like a direct translation or close paraphrase of the source.

The date MUST remain exactly:
"${dateNp}"

Fresh horoscope ideas:
${JSON.stringify(
  freshIdeas.data,
  null,
  2
)}

Return ONLY this JSON:

{
  "date_np": "${dateNp}",
  "date": "${dateEn}",
  "day": "${dayName}",
  "status_message": "",
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Taurus",
      "sign_np": "वृष",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Gemini",
      "sign_np": "मिथुन",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Cancer",
      "sign_np": "कर्कट",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Leo",
      "sign_np": "सिंह",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Virgo",
      "sign_np": "कन्या",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Libra",
      "sign_np": "तुला",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Scorpio",
      "sign_np": "वृश्चिक",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Sagittarius",
      "sign_np": "धनु",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Capricorn",
      "sign_np": "मकर",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Aquarius",
      "sign_np": "कुम्भ",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    },
    {
      "sign": "Pisces",
      "sign_np": "मीन",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य।"
    }
  ]
}

CRITICAL:
Return ONLY valid JSON.
No markdown.
No explanation.
No extra text.`;

  return await callGeminiWithValidator(
    generationPrompt,
    (content) =>
      parseAndValidateGeminiResult(
        content,
        dateEn
      ),
    availableModels
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

  if (
    !rawContent ||
    !rawContent.trim()
  ) {
    console.error(
      "❌ Raw Rashifal source data is empty. Gemini generation skipped."
    );

    return false;
  }

  console.log(
    `📰 [PIPELINE SOURCE] ${sourceUsed} को data प्रयोग गरेर Rashifal pipeline सुरु हुँदैछ।`
  );

  try {
    // ------------------------------------------------------
    // DISCOVER MODELS ONLY ONCE FOR THIS WORKFLOW
    // ------------------------------------------------------
    console.log(
      "🔎 [GEMINI] यो workflow का लागि usable models एकपटक मात्र discover गरिँदैछ..."
    );

    const availableModels =
      await getAvailableGeminiModels();

    if (!availableModels.length) {
      throw new Error(
        "No usable Gemini Flash models are available."
      );
    }

    // ------------------------------------------------------
    // STEP 1: RAW NEPALI → ENGLISH SEMANTIC INTERMEDIATE
    // ------------------------------------------------------
    console.log(
      "🌐 STEP 1/3: Raw Nepali source लाई English semantic meaning मा बदलिँदैछ..."
    );

    const englishIntermediate =
      await translateRawToEnglish(
        rawContent,
        availableModels
      );

    console.log(
      "✅ STEP 1/3 complete: English semantic intermediate तयार भयो।"
    );

    console.log(
      `📊 English intermediate मा ${englishIntermediate.data.length} वटा zodiac signs छन्।`
    );

    // ------------------------------------------------------
    // STEP 2: CREATE FRESH HOROSCOPE IDEAS / ANGLES
    // ------------------------------------------------------
    console.log(
      "💡 STEP 2/3: प्रत्येक राशिका लागि 4 वटा fresh horoscope ideas/angles तयार हुँदैछन्..."
    );

    const freshIdeas =
      await createFreshHoroscopeIdeas(
        englishIntermediate,
        availableModels
      );

    console.log(
      "✅ STEP 2/3 complete: Fresh horoscope ideas/angles तयार भए।"
    );

    // ------------------------------------------------------
    // STEP 3: FRESH IDEAS → NATURAL NEPALI
    // ------------------------------------------------------
    console.log(
      "✍️ STEP 3/3: Fresh ideas बाट original natural Nepali Rashifal तयार हुँदैछ..."
    );

    const generatedData =
      await generateFreshNepali(
        freshIdeas,
        dateEn,
        dayName,
        dateNp,
        availableModels
      );

    cache = {
      data: generatedData,
      last_updated:
        new Date().toISOString()
    };

    console.log(
      `✅ Success! ${dateEn} को fresh Nepali राशिफल successfully generate भयो र cache update भयो।`
    );

    return true;

  } catch (err) {
    console.error(
      "❌ Gemini/Rashifal Processing Failed:",
      err.message
    );

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

    cache = {
      data: null,
      last_updated: null
    };

    // ------------------------------------------------------
    // SOURCE FETCH
    // HamroPatro → NepaliPatro fallback
    // ------------------------------------------------------
    const {
      data: rawData,
      source
    } = await fetchRawData();

    if (
      !rawData ||
      !rawData.trim()
    ) {
      console.error(
        "❌ कुनै पनि Rashifal source बाट data प्राप्त भएन।"
      );

      return false;
    }

    console.log(
      `🟢 [WORKFLOW SOURCE CONFIRMED] ${source}`
    );

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
app.get(
  "/api/rasifal",
  (req, res) => {
    const {
      date_en: currentDate
    } = getNepaliDateText();

    if (!cache.data) {
      return res.status(503).json({
        status: "error",
        message:
          "आजको राशिफल उपलब्ध छैन। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।"
      });
    }

    if (
      cache.data.date !== currentDate
    ) {
      return res.status(503).json({
        status: "error",
        message:
          "आजको राशिफल उपलब्ध छैन। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।"
      });
    }

    res.json(cache.data);
  }
);

// ==========================================================
// MANUAL GENERATE API
// ==========================================================
app.get(
  "/api/generate-now",
  async (req, res) => {
    if (workflowRunning) {
      return res.status(409).json({
        status: "error",
        message:
          "राशिफल अहिले generate हुँदैछ। कृपया केही समयपछि फेरि प्रयास गर्नुहोस्।"
      });
    }

    const success =
      await runWorkflow();

    if (success) {
      res.json({
        status: "success",
        message:
          "सफलतापूर्वक जेनेरेट भयो!",
        data: cache.data
      });
    } else {
      res.status(500).json({
        status: "error",
        message:
          "आजको राशिफल केही technical problem ले उपलब्ध हुन सकेन, कृपया केही समय पछाडि try गर्नुहोस्।"
      });
    }
  }
);

// ==========================================================
// FUEL RATE ROUTER
// ==========================================================
const fuelRateRouter =
  require("./fuelRate");

app.use(
  "/api",
  fuelRateRouter
);

// ==========================================================
// START SERVER
// ==========================================================
app.listen(
  PORT,
  async () => {
    console.log(
      `🚀 Server running on port ${PORT}`
    );

    if (!cache.data) {
      await runWorkflow();
    }
  }
);
