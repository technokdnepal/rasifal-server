````js
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
        `🔍 [प्रयास ${attempt}/3] ${name} बाट डाटा तान्दै...`
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

  try {
    const parsed = JSON.parse(message);

    if (parsed?.error) {
      status = parsed.error.code ?? status;
      message =
        parsed.error.message || message;
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
function isPermanentGeminiError(err) {
  const { status, message } =
    getGeminiErrorInfo(err);

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
function isRetryableGeminiError(err) {
  const { status, message } =
    getGeminiErrorInfo(err);

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
      (
        model?.name
          ? model.name.replace(/^models\//, "")
          : ""
      );

    if (!name) {
      continue;
    }

    const lowerName = name.toLowerCase();

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
      a.id.toLowerCase().includes("flash-lite");

    const bLite =
      b.id.toLowerCase().includes("flash-lite");

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
    `✅ ${uniqueModels.length} वटा usable Gemini Flash models भेटिए:`
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
        .map(s => s.trim())
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
// GENERIC GEMINI CALL WITH DYNAMIC FAILOVER
// ==========================================================
async function callGeminiWithValidator(
  promptText,
  validator
) {
  let retryModels = [];
  let delayIndex = 0;

  while (true) {
    let availableModels;

    try {
      availableModels =
        await getAvailableGeminiModels();
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

      await sleep(delay);

      if (
        delayIndex <
        GEMINI_RETRY_DELAYS.length - 1
      ) {
        delayIndex++;
      }

      continue;
    }

    retryModels = [];

    for (const model of availableModels) {
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

        if (
          isPermanentGeminiError(err)
        ) {
          console.warn(
            `⏭️ ${model.id} unsupported/deprecated/blocked जस्तो देखियो। Skip गरिँदैछ।`
          );

          continue;
        }

        retryModels.push(model);
      }
    }

    if (!retryModels.length) {
      console.log(
        "⚠️ Retry गर्न मिल्ने model भेटिएन। नयाँ models फेरि खोजिँदैछ..."
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

    const stillRetryable = [];

    for (const model of retryModels) {
      try {
        console.log(
          `🔁 Retry: Gemini (${model.id})`
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
          `✅ Retry मा ${model.id} सफल भयो!`
        );

        return parsed;

      } catch (err) {
        const {
          message
        } = getGeminiErrorInfo(err);

        console.warn(
          `⚠️ Retry मा ${model.id} फेरि असफल: ${message}`
        );

        if (
          isPermanentGeminiError(err)
        ) {
          console.warn(
            `⏭️ ${model.id} अब unsupported/deprecated/blocked देखियो।`
          );

          continue;
        }

        stillRetryable.push(model);
      }
    }

    retryModels =
      stillRetryable;

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
// TRANSLATE RAW NEPALI → ENGLISH INTERMEDIATE
// ==========================================================
async function translateRawToEnglish(
  rawContent
) {
  const translationPrompt = `You are preparing an English intermediate representation of Nepali horoscope source material.

Your job is ONLY to translate and structure the supplied source into clear English meaning.

IMPORTANT:
- Do NOT write the final horoscope.
- Do NOT add new predictions.
- Do NOT embellish the source.
- Do NOT invent facts.
- Preserve the general meaning and themes of each zodiac sign.
- This English version is an intermediate semantic representation for another AI step.
- Do not preserve the original Nepali sentence structure.
- Do not perform a word-for-word translation.
- If the source contains repetitive or awkward wording, express the underlying meaning clearly in English.
- Ignore lucky colors, lucky numbers, lucky directions and gemstones.
- We need exactly 12 zodiac signs.
- If the source has headings or zodiac names, map them to the correct English and Nepali sign names.

Raw scraped source:
${rawContent.substring(0, 12000)}

Return ONLY valid JSON:

{
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Taurus",
      "sign_np": "वृष",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Gemini",
      "sign_np": "मिथुन",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Cancer",
      "sign_np": "कर्कट",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Leo",
      "sign_np": "सिंह",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Virgo",
      "sign_np": "कन्या",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Libra",
      "sign_np": "तुला",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Scorpio",
      "sign_np": "वृश्चिक",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Sagittarius",
      "sign_np": "धनु",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Capricorn",
      "sign_np": "मकर",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Aquarius",
      "sign_np": "कुम्भ",
      "meaning": "Clear English summary of the source meaning for this sign."
    },
    {
      "sign": "Pisces",
      "sign_np": "मीन",
      "meaning": "Clear English summary of the source meaning for this sign."
    }
  ]
}

Return nothing except the JSON object.`;

  return await callGeminiWithValidator(
    translationPrompt,
    parseAndValidateEnglishIntermediate
  );
}

// ==========================================================
// GENERATE FRESH NEPALI FROM ENGLISH MEANING
// ==========================================================
async function generateFreshNepali(
  englishIntermediate,
  dateEn,
  dayName,
  dateNp
) {
  const generationPrompt = `You are an original Nepali horoscope writer.

You are given an ENGLISH INTERMEDIATE MEANING derived from horoscope source material.

Your task is NOT to translate the original source and NOT to rewrite its sentences.

Instead, understand the general meaning/themes in the English intermediate and write a completely fresh, natural Nepali horoscope in your own wording and sentence structure.

The final Nepali text must feel independently written.

IMPORTANT ORIGINALITY RULES:
1. Do not copy or closely paraphrase the source wording.
2. Do not translate any source sentence literally.
3. Do not preserve the source sentence order.
4. You may reorganize related ideas naturally.
5. Use different sentence structures and natural Nepali phrasing.
6. Preserve only the underlying general astrological meaning/themes.
7. Do not introduce specific new predictions that are not supported by the provided meaning.
8. Do not use names of the source websites.
9. Do not mention that the content was translated, rewritten, scraped, or generated.
10. Do not use quotations from the source.
11. Write like an original short daily horoscope for a Nepali reader.
12. Use simple, conversational Nepali.
13. Avoid heavy Sanskritized or overly formal language.
14. Do not start sentences with "आजको दिन" or "यस दिन".
15. Do not put the zodiac sign name inside the prediction.
16. Do not include lucky colors, lucky numbers, lucky directions, gemstones, or similar details.
17. Each zodiac sign MUST contain EXACTLY 4 sentences.
18. Keep each sentence reasonably short and natural.
19. Do not use awkward mixed-language phrases such as "कसै fromबाट".
20. Use normal Nepali grammar and punctuation.

The date MUST remain exactly:
"${dateNp}"

English intermediate meaning:
${JSON.stringify(englishIntermediate.data, null, 2)}

Return ONLY this JSON structure:

{
  "date_np": "${dateNp}",
  "date": "${dateEn}",
  "day": "${dayName}",
  "status_message": "",
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Taurus",
      "sign_np": "वृष",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Gemini",
      "sign_np": "मिथुन",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Cancer",
      "sign_np": "कर्कट",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Leo",
      "sign_np": "सिंह",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Virgo",
      "sign_np": "कन्या",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Libra",
      "sign_np": "तुला",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Scorpio",
      "sign_np": "वृश्चिक",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Sagittarius",
      "sign_np": "धनु",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Capricorn",
      "sign_np": "मकर",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Aquarius",
      "sign_np": "कुम्भ",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
    },
    {
      "sign": "Pisces",
      "sign_np": "मीन",
      "prediction": "चार वटा प्राकृतिक नेपाली वाक्य। चार वाक्य मात्र।"
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
      )
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
    `📰 Source selected: ${sourceUsed}`
  );

  try {
    // ------------------------------------------------------
    // STEP 1: Nepali source → English semantic intermediate
    // ------------------------------------------------------
    console.log(
      "🌐 STEP 1/2: Raw Nepali horoscope लाई English intermediate meaning मा रूपान्तरण गर्दै..."
    );

    const englishIntermediate =
      await translateRawToEnglish(
        rawContent
      );

    console.log(
      "✅ English intermediate successfully तयार भयो।"
    );

    console.log(
      `📊 English intermediate मा ${englishIntermediate.data.length} वटा zodiac signs छन्।`
    );

    // ------------------------------------------------------
    // STEP 2: English meaning → fresh original Nepali
    // ------------------------------------------------------
    console.log(
      "✍️ STEP 2/2: English meaning बाट fresh Nepali Rashifal तयार गर्दै..."
    );

    const generatedData =
      await generateFreshNepali(
        englishIntermediate,
        dateEn,
        dayName,
        dateNp
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
      "❌ Rashifal AI Processing Failed:",
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
});

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
````
