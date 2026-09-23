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

const fs = require("fs");
const path = require("path");

let cache = {
  data: null,
  last_updated: null
};

// Prevent overlapping Rashifal workflows
let workflowRunning = false;

// Daily retry-window state: bounded 12:05 AM-6:00 AM schedule.
// A date-stamped flag prevents repeat same-day generation after success.
let dailyAttempt = {
  date_en: null,
  done: false
};

// Persistent same-day cache so a normal restart does not regenerate
// today's Rashifal. In-memory cache alone is wiped on restart.
const CACHE_FILE = path.join(__dirname, "rashifal-cache.json");

function loadPersistedCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return;
    }

    const persisted = JSON.parse(
      fs.readFileSync(CACHE_FILE, "utf8")
    );

    if (
      persisted &&
      persisted.cache &&
      persisted.cache.data &&
      persisted.dailyAttempt &&
      persisted.dailyAttempt.date_en &&
      persisted.dailyAttempt.done === true &&
      persisted.cache.data.date === persisted.dailyAttempt.date_en
    ) {
      cache = persisted.cache;
      dailyAttempt = persisted.dailyAttempt;
    }
  } catch (_) {
    // Corrupt cache file must never break startup.
  }
}

function savePersistedCache() {
  try {
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify(
        {
          cache,
          dailyAttempt
        },
        null,
        2
      )
    );
  } catch (_) {
    // Cache persistence is best-effort only.
  }
}

loadPersistedCache();

// ==========================================================
// TODAY'S CACHE CHECK — SAME NEPALI DATE ALREADY GENERATED?
// ==========================================================
// Conservative: BOTH memory cache AND in-progress daily flag must
// agree with today's date before skipping Gemini. A restart clears
// memory, so a stale in-memory value alone must never skip work.
function hasValidTodayCache(dateEn) {
  if (!dateEn) {
    return false;
  }

  if (
    !cache.data ||
    cache.data.date !== dateEn ||
    !Array.isArray(cache.data.data) ||
    cache.data.data.length !== 12
  ) {
    return false;
  }

  return (
    dailyAttempt.date_en === dateEn &&
    dailyAttempt.done === true
  );
}

// ==========================================================
// DYNAMIC NEPALI DATE FUNCTION
// ==========================================================
function getNepaliDateText(options = {}) {
  const nepalNow = moment().tz("Asia/Kathmandu");
  const hour = nepalNow.hour();

  let targetMoment = nepalNow.clone();

  // Legacy 4 AM cutoff: before 4 AM counts as the previous Nepali day.
  // Preserved for backward compatibility. The Rashifal workflow must NOT
  // use this cutoff — it calls getRashifalDateText() instead, which always
  // uses the actual current Nepal date.
  const useCutoff = !(options && options.currentDate === true);

  if (useCutoff && hour < 4) {
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
// RASHIFAL CURRENT-DATE — ACTUAL NEPAL DATE, NO 4 AM CUTOFF
// ==========================================================
// The Rashifal workflow always uses the actual current Nepal AD date →
// current BS date, at 12:05 AM, 1:00 AM, 3:30 AM, 4:00 AM+, etc.
// getNepaliDateText() keeps its legacy <4 AM rule untouched for any
// other non-Rashifal behavior.
function getRashifalDateText() {
  return getNepaliDateText({ currentDate: true });
}

// ==========================================================
// NEPALI DIGITS / MONTHS / WEEKDAYS SHARED BY SCRAPED-DATE CHECK
// ==========================================================
const NEPALI_DIGITS_REVERSE = {
  "०": "0",
  "१": "1",
  "२": "2",
  "३": "3",
  "४": "4",
  "५": "5",
  "६": "6",
  "७": "7",
  "८": "8",
  "९": "9"
};

const NEPALI_MONTH_NAME_TO_NUMBER = {
  "बैशाख": 1,
  "जेठ": 2,
  "असार": 3,
  "श्रावण": 4,
  "साउन": 4,
  "भदौ": 5,
  "भाद्र": 5,
  "असोज": 6,
  "आश्विन": 6,
  "कार्तिक": 7,
  "कात्तिक": 7,
  "मंसिर": 8,
  "मार्ग": 8,
  "पौष": 9,
  "पुस": 9,
  "माघ": 10,
  "फागुन": 11,
  "फाल्गुन": 11,
  "चैत": 12,
  "चैत्र": 12
};

function normalizeNepaliDigits(text) {
  return String(text || "").replace(
    /[०-९]/g,
    (digit) => NEPALI_DIGITS_REVERSE[digit]
  );
}

// ==========================================================
// SCRAPED SOURCE-DATE CHECK — STALE SOURCE MUST NOT REACH GEMINI
// ==========================================================
// HamroPatro exposes its Rashifal date in the page HTML such as
// "राशिफल ०७ आश्विन २०८३ बुधवार" (BS day, BS month name, BS year).
// There is no dependable separate AD date field on that fragment, so
// compare BS day/month/year to today's BS date derived server-side.
// NepaliPatro's HTML currently exposes no usable per-day Rashifal
// date, so its freshness cannot be verified: it stays lower priority
// and is treated as unverified, never as confirmed current.
function parseHamroPatroSourceDateBs(html) {
  const text = normalizeNepaliDigits(
    cheerio.load(html || "").text()
  );

  // Prefer an explicit Rashifal label first. Fallback generic matches
  // require a nearby Rashifal context so unrelated page dates cannot
  // falsely validate stale content.
  const labeledMatch =
    text.match(/राशिफल\s*(\d{1,2})\s+([^\s\d]+)\s+(\d{4})/);

  if (labeledMatch) {
    const monthNumber =
      NEPALI_MONTH_NAME_TO_NUMBER[labeledMatch[2]] || null;

    if (!monthNumber) {
      return null;
    }

    return {
      day: Number(labeledMatch[1]),
      month: monthNumber,
      year: Number(labeledMatch[3])
    };
  }

  const rashifalIndex = text.indexOf("राशिफल");

  if (rashifalIndex < 0) {
    return null;
  }

  const nearbyText = text.slice(
    Math.max(0, rashifalIndex - 80),
    rashifalIndex + 120
  );

  const nearbyMatch = nearbyText.match(
    /(\d{1,2})\s+([^\s\d]+)\s+(\d{4})/
  );

  if (!nearbyMatch) {
    return null;
  }

  const monthNumber =
    NEPALI_MONTH_NAME_TO_NUMBER[nearbyMatch[2]] || null;

  if (!monthNumber) {
    return null;
  }

  return {
    day: Number(nearbyMatch[1]),
    month: monthNumber,
    year: Number(nearbyMatch[3])
  };
}

function getTodayBsParts(dateEn) {
  const bsDate = adToBs(dateEn);

  if (typeof bsDate === "string") {
    const parts = bsDate.split("-");

    return {
      year: parseInt(parts[0], 10),
      month: parseInt(parts[1], 10),
      day: parseInt(parts[2], 10)
    };
  }

  if (bsDate && typeof bsDate === "object") {
    return {
      year: Number(bsDate.year),
      month: Number(bsDate.month),
      day: Number(bsDate.day ?? bsDate.date)
    };
  }

  return null;
}

function isCurrentDaySource(html, dateEn, sourceName) {
  if (!html || !dateEn) {
    return false;
  }

  const todayBs = getTodayBsParts(dateEn);

  if (
    !todayBs ||
    !todayBs.year ||
    !todayBs.month ||
    !todayBs.day
  ) {
    return false;
  }

  if (sourceName === "HamroPatro") {
    const sourceBs = parseHamroPatroSourceDateBs(html);

    if (!sourceBs) {
      console.warn(
        "⚠️ HamroPatro source date फेला परेन। stale हुन सक्ने भएकाले Gemini मा पठाइँदैन।"
      );

      return false;
    }

    const isCurrent =
      sourceBs.year === todayBs.year &&
      sourceBs.month === todayBs.month &&
      sourceBs.day === todayBs.day;

    if (!isCurrent) {
      console.warn(
        `⏳ HamroPatro मा अझै आजको राशिफल आएको छैन (source BS ${sourceBs.year}-${sourceBs.month}-${sourceBs.day}, today BS ${todayBs.year}-${todayBs.month}-${todayBs.day})।`
      );
    }

    return isCurrent;
  }

  // NepaliPatro: no verifiable per-day date in current HTML.
  return false;
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
      // collect paragraph text as a fallback.
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
          text: scrapedText,
          lastHtml: data
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
    text: null,
    lastHtml: null
  };
}

// ==========================================================
// FETCH RAW DATA
// HamroPatro → NepaliPatro fallback
// ==========================================================
// Stale-source protection: a fetched page is only "current" when its
// own date matches today's Nepali date. Unverified/stale content is
// NEVER returned as today's source, so Gemini cannot stamp yesterday's
// Rashifal with today's date. When html is needed for the date check,
// scrapeWithRetry result is reused via lastHtml, avoiding extra calls.
// ==========================================================
async function fetchRawData(dateEn) {
  console.log(
    "📰 [SOURCE] पहिले HamroPatro बाट Rashifal data खोजिँदैछ..."
  );

  const result = await scrapeWithRetry(
    "https://www.hamropatro.com/rashifal",
    "हाम्रो पात्रो"
  );

  if (result.success) {
    if (
      dateEn &&
      !isCurrentDaySource(result.lastHtml, dateEn, "HamroPatro")
    ) {
      console.warn(
        "⏳ HamroPatro को source अझै आजको होइन। Gemini मा पठाइँदैन; अर्को scheduled retry मा फेरि जाँच हुनेछ।"
      );
    } else {
      console.log(
        "🟢 [SOURCE SELECTED] HamroPatro प्रयोग हुँदैछ।"
      );

      return {
        data: result.text,
        source: "HamroPatro"
      };
    }
  }

  console.warn(
    "🔴 [SOURCE FALLBACK] HamroPatro बाट आजको Rashifal भेटिएन। अब NepaliPatro मा fallback हुँदैछ..."
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
    if (
      dateEn &&
      !isCurrentDaySource(backupResult.lastHtml, dateEn, "NepaliPatro")
    ) {
      console.warn(
        "⏳ NepaliPatro source को freshness verify हुन सकेन। stale हुन सक्ने भएकाले Gemini मा पठाइँदैन।"
      );
    } else {
      console.log(
        "🟢 [SOURCE SELECTED] NepaliPatro fallback रूपमा प्रयोग हुँदैछ।"
      );

      return {
        data: backupResult.text,
        source: "NepaliPatro"
      };
    }
  }

  console.error(
    "🔴 [SOURCE FAILED] आजको Rashifal कुनै पनि source मा तयार छैन।"
  );

  return {
    data: null,
    source: "None"
  };
}

// ==========================================================
// GEMINI CONTROLLED RETRY SETTINGS
// ==========================================================
//
// Direct Gemini generation मात्र हुन्छ।
//
// Maximum:
// - Initial pass: up to 5 usable models
// - Controlled retry: temporary-failed models मात्र
// - Maximum 2 passes
//
// कुनै infinite retry loop छैन।
// ==========================================================
const GEMINI_MAX_MODELS_PER_PASS = 5;
const GEMINI_MAX_PASSES = 2;

const GEMINI_RETRY_DELAYS = [
  5000,
  15000
];

// Per-request timeout so a hung Gemini call cannot hang the workflow
// forever. Minimal fix: SDK calls have no timeout option, so race them.
const GEMINI_REQUEST_TIMEOUT_MS = 60000;

// Temporary model cooldowns: overloaded models recover later.
// Cooldown ladder: ~5 min, then ~15 min, then ~30 min.
const GEMINI_COOLDOWN_STEPS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  30 * 60 * 1000
];

const geminiModelCooldownUntil = new Map();
const geminiModelTempFailureCount = new Map();
const geminiModelPermanentlyUnusable = new Set();

function isGeminiModelInCooldown(modelId) {
  const until = geminiModelCooldownUntil.get(modelId) || 0;

  if (Date.now() < until) {
    return true;
  }

  if (until) {
    geminiModelCooldownUntil.delete(modelId);
  }

  return false;
}

function markGeminiModelTemporaryFailure(modelId) {
  const failures =
    (geminiModelTempFailureCount.get(modelId) || 0) + 1;

  geminiModelTempFailureCount.set(modelId, failures);

  const stepIndex = Math.min(
    failures - 1,
    GEMINI_COOLDOWN_STEPS_MS.length - 1
  );

  const until =
    Date.now() + GEMINI_COOLDOWN_STEPS_MS[stepIndex];

  geminiModelCooldownUntil.set(modelId, until);

  console.warn(
    `⏳ ${modelId} temporary failure (${failures}x). Cooldown ${Math.round(GEMINI_COOLDOWN_STEPS_MS[stepIndex] / 60000)} min.`
  );
}

function markGeminiModelRecovered(modelId) {
  geminiModelTempFailureCount.delete(modelId);
  geminiModelCooldownUntil.delete(modelId);
}

function getEligibleGeminiModels(models) {
  return (models || []).filter(
    (model) =>
      !geminiModelPermanentlyUnusable.has(model.id) &&
      !isGeminiModelInCooldown(model.id)
  );
}

function withGeminiTimeout(promise, label = "Gemini request") {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms.`
        )
      );
    }, GEMINI_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================================
// EXTRACT GEMINI ERROR INFO
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
// DETECT PERMANENT / UNUSABLE GEMINI ERRORS
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
// DETECT RETRYABLE TEMPORARY GEMINI ERRORS
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
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout") ||
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
// DISCOVER CURRENTLY AVAILABLE GEMINI FLASH MODELS
// ==========================================================
async function getAvailableGeminiModels() {
  console.log(
    "🔎 Google Gemini बाट अहिले उपलब्ध usable Flash models खोज्दै..."
  );

  const pager =
    await withGeminiTimeout(
      ai.models.list({
        config: {
          pageSize: 100
        }
      }),
      "Gemini model discovery"
    );

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
// CLEAN GEMINI JSON
// ==========================================================
function cleanGeminiJson(content) {
  return content
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
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

  // Pass 0 uses the first eligible group for cost control. Later
  // passes rotate through every still-eligible discovered model while
  // respecting permanent failures and temporary cooldowns. Newly
  // discovered usable models flow through availableModels unchanged.
  const candidateModels =
    getEligibleGeminiModels(availableModels).slice(
      0,
      Math.min(
        GEMINI_MAX_MODELS_PER_PASS,
        getEligibleGeminiModels(availableModels).length
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
        ? getEligibleGeminiModels(candidateModels)
        : getEligibleGeminiModels(availableModels).filter(
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
          await withGeminiTimeout(
            ai.models.generateContent({
              model: model.id,
              contents: promptText
            }),
            `Gemini generateContent (${model.id})`
          );

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

        markGeminiModelRecovered(model.id);

        console.log(
          `✅ ${model.id} बाट valid Rashifal response सफलतापूर्वक प्राप्त भयो!`
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

          geminiModelPermanentlyUnusable.add(model.id);

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
          markGeminiModelTemporaryFailure(model.id);

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
// DIRECT GEMINI → NATURAL LOCAL NEPALI RASHIFAL
// ==========================================================
async function generateDirectNepali(
  rawContent,
  dateEn,
  dayName,
  dateNp,
  availableModels
) {
  const generationPrompt = `तिमी नेपाली राशिफल लेख्ने लेखक हौ।

तल दिइएको सामग्री हाम्रो पात्रो/अन्य राशिफल स्रोतबाट आएको कच्चा नेपाली राशिफल हो।

तिम्रो काम भनेको त्यसमा लेखिएको मुख्य अर्थ, सन्देश र राशिफलका कुराहरू बुझेर त्यही अर्थ कायम राख्दै नयाँ तरिकाले राशिफल लेख्नु हो।

सबैभन्दा महत्वपूर्ण कुरा:

१. स्रोतको कुरा र अर्थ नबिगार।
२. तर स्रोतका वाक्यहरू जस्ताको तस्तै copy नगर।
३. स्रोतका शब्दहरू मात्र साटेर sentence-by-sentence paraphrase पनि नगर।
४. वाक्यको structure, शब्द छनोट र लेख्ने तरिका आफ्नै बनाऊ।
५. स्रोतमा नभएको नयाँ भविष्यवाणी, घटना वा दाबी नथप।
६. स्रोतमा भएको मुख्य कुरा भने छुट्न नदेऊ।
७. अन्तिम लेखाइ नेपालीमै हुनुपर्छ।

NEPALI STYLE:

- एकदमै natural र local नेपाली प्रयोग गर।
- नेपालमा सामान्य मान्छेले दैनिक कुराकानीमा बोल्ने नेपालीजस्तो बनाऊ।
- चिया पसलमा, स्कुल-कलेजमा वा साथीभाइसँग सामान्य कुरा गर्दा सुनिने सहज नेपालीको शैली सम्झ।
- धेरै संस्कृतनिष्ठ, किताबी वा पुरानो शैलीको नेपाली नलेख।
- अनावश्यक गाह्रो शब्द नचलाऊ।
- अत्यधिक formal नेपाली नबनाऊ।
- पढ्दा "AI ले लेखेको" वा "translation गरेको" जस्तो महसुस नहोस्।
- सामान्य नेपाली user ले सजिलै बुझ्ने भाषा प्रयोग गर।
- नेपाली वाक्यभित्र अनावश्यक English शब्द नहाल।
- तर नेपालमा दैनिक बोलिचालीमै चल्ने सामान्य शब्द आवश्यक परे प्रयोग गर्न सकिन्छ।
- भाषा natural, smooth र conversational हुनुपर्छ।

CONTENT RULES:

- जम्मा १२ वटा राशिका लागि राशिफल लेख।
- प्रत्येक राशिमा ठ्याक्कै ४ वटा वाक्य हुनुपर्छ।
- प्रत्येक वाक्यमा फरक मुख्य कुरा/angle समेट।
- राशिको नाम prediction भित्र नलेख।
- "आजको दिन" बाट prediction सुरु नगर।
- "यस दिन" बाट prediction सुरु नगर।
- lucky color नलेख।
- lucky number नलेख।
- lucky direction नलेख।
- gemstone/रत्न नलेख।
- स्रोतमा नभएको कुरा आफैंबाट नबनाऊ।
- एउटै कुरा घुमाएर चार पटक नलेख।
- चारवटै वाक्य जोडिएर एउटा natural horoscope paragraph जस्तो लाग्नुपर्छ।
- अत्यधिक सकारात्मक वा अत्यधिक नकारात्मक बनाएर अर्थ नबदल।
- स्रोतको मूल सन्देशलाई प्राथमिकता देऊ।
- वाक्यहरू प्राकृतिक र फरक structure का बनाऊ।
- प्रत्येक राशिको prediction ४ वाक्य मात्र होस्।
- हरेक वाक्यको अन्त्यमा नेपाली पूर्णविराम "।" प्रयोग गर।

SOURCE REWRITING PRINCIPLE:

SOURCE:
स्रोतमा जे भनिएको छ त्यसको अर्थ बुझ।

THEN:
त्यही अर्थलाई नयाँ शब्द, नयाँ sentence structure र natural local Nepali writing style मा लेख।

DO NOT:
- literal translation
- sentence-by-sentence paraphrase
- word replacement मात्र
- source को sentence order copy
- source को exact phrase copy

DO:
- meaning preserve
- natural restructuring
- fresh wording
- conversational Nepali
- human-like local Nepali tone

उदाहरण:

यदि स्रोतमा:
"काममा नयाँ अवसर प्राप्त हुन सक्छ। सहकर्मीबाट सहयोग मिल्नेछ।"

भने यसलाई:
"कामको सिलसिलामा नयाँ मौका भेटिन सक्छ। वरिपरिका मानिसको साथ पाएपछि केही काम सजिलै अघि बढ्ने देखिन्छ।"

जस्तो नयाँ तर natural शैलीमा लेख्न सकिन्छ।

अर्थ उही छ, तर शब्द र sentence structure फरक छन्।

DATE:

अन्तिम JSON मा date_np, date र day यी तीनवटै field अनिवार्य छन्।

date:
"${dateEn}"

day:
"${dayName}"

date_np:
"${dateNp}"

RAW SOURCE RASHIFAL:
${rawContent.substring(0, 16000)}

अब स्रोतको अर्थ राम्ररी बुझेर त्यसलाई नयाँ, natural, local Nepali भाषामा लेख।

Return ONLY valid JSON.

JSON structure:

{
  "date_np": "${dateNp}",
  "date": "${dateEn}",
  "day": "${dayName}",
  "status_message": "",
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Taurus",
      "sign_np": "वृष",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Gemini",
      "sign_np": "मिथुन",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Cancer",
      "sign_np": "कर्कट",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Leo",
      "sign_np": "सिंह",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Virgo",
      "sign_np": "कन्या",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Libra",
      "sign_np": "तुला",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Scorpio",
      "sign_np": "वृश्चिक",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Sagittarius",
      "sign_np": "धनु",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Capricorn",
      "sign_np": "मकर",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Aquarius",
      "sign_np": "कुम्भ",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    },
    {
      "sign": "Pisces",
      "sign_np": "मीन",
      "prediction": "चार वटा natural नेपाली वाक्य।"
    }
  ]
}

CRITICAL:
- Return ONLY valid JSON.
- No markdown.
- No explanation.
- No extra text.
- Exactly 12 zodiac signs.
- Exactly 4 sentences per prediction.
- Natural local Nepali only.`;

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
    `📰 [DIRECT GEMINI] ${sourceUsed} को raw Rashifal data सिधै Gemini लाई दिइँदैछ।`
  );

  try {
    // ------------------------------------------------------
    // DISCOVER MODELS ONLY ONCE
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
    // DIRECT GENERATION
    // ------------------------------------------------------
    console.log(
      "✍️ [DIRECT GEMINI] Raw Nepali Rashifal को अर्थ बुझेर fresh local Nepali Rashifal तयार हुँदैछ..."
    );

    const generatedData =
      await generateDirectNepali(
        rawContent,
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

    dailyAttempt = {
      date_en: dateEn,
      done: true
    };

    savePersistedCache();

    console.log(
      `✅ Success! ${dateEn} को fresh local Nepali राशिफल successfully generate भयो र cache update भयो।`
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
// Cache-first + stale-source guard:
// - Today's valid cache stops before any scrape/Gemini work.
// - Yesterday/old cache is cleared only when today's run begins.
// - A manual/restart call for an already-completed date is a no-op.
async function runWorkflow(options = {}) {
  const reason = options.reason || "scheduled";
  const force = options.force === true;

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
    } = getRashifalDateText();

    // New Nepali date resets the same-day completion marker.
    if (dailyAttempt.date_en !== date_en) {
      dailyAttempt = {
        date_en: null,
        done: false
      };
    }

    if (!force && hasValidTodayCache(date_en)) {
      console.log(
        `✅ ${date_en} को राशिफल पहिले नै तयार छ। Gemini फेरि call गरिँदैन (${reason})।`
      );

      return true;
    }

    console.log(
      `🚀 ${date_en} (${day}) को लागि राशिफल वर्कफ्लो सुरु हुँदैछ...`
    );

    // Only today's workflow owns cache clearing. Manual same-day calls
    // never wipe an existing valid cache for that date.
    if (
      !cache.data ||
      cache.data.date !== date_en
    ) {
      cache = {
        data: null,
        last_updated: null
      };
    }

    // ------------------------------------------------------
    // SOURCE FETCH
    // HamroPatro → NepaliPatro fallback
    // ------------------------------------------------------
    const {
      data: rawData,
      source
    } = await fetchRawData(date_en);

    if (
      !rawData ||
      !rawData.trim()
    ) {
      console.error(
        "❌ आजको Rashifal source अझै तयार छैन। अर्को scheduled retry मा फेरि प्रयास हुनेछ।"
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

    return false;

  } finally {
    workflowRunning = false;
  }
}

// ==========================================================
// DAILY 12:05 AM-6:00 AM RETRY SCHEDULE — FIXED CRON TIMES ONLY
// ==========================================================
// Exact required times: 12:05, 12:30, 1:00, 1:30, 2:00, 3:00,
// 3:30, 4:00, 4:30, 5:00, 5:30, 5:50. Intentional 2:00-3:00 gap.
// Each tick is cache-first, stale-source guarded, overlap guarded,
// and stops entirely once today's Rashifal is cached. No loops,
// no dynamic timers, so generation cannot continue past 6:00 AM.
function scheduleDailyRetry(cronTime, label) {
  cron.schedule(
    cronTime,
    () => {
      runWorkflow({ reason: label });
    },
    {
      scheduled: true,
      timezone: "Asia/Kathmandu"
    }
  );
}

scheduleDailyRetry("5 0 * * *", "daily-0-05");
scheduleDailyRetry("30 0 * * *", "daily-0-30");
scheduleDailyRetry("0 1 * * *", "daily-1-00");
scheduleDailyRetry("30 1 * * *", "daily-1-30");
scheduleDailyRetry("0 2 * * *", "daily-2-00");
scheduleDailyRetry("0 3 * * *", "daily-3-00");
scheduleDailyRetry("30 3 * * *", "daily-3-30");
scheduleDailyRetry("0 4 * * *", "daily-4-00");
scheduleDailyRetry("30 4 * * *", "daily-4-30");
scheduleDailyRetry("0 5 * * *", "daily-5-00");
scheduleDailyRetry("30 5 * * *", "daily-5-30");
scheduleDailyRetry("50 5 * * *", "daily-5-50");

// ==========================================================
// RASIFAL API
// ==========================================================
app.get(
  "/api/rasifal",
  (req, res) => {
    const {
      date_en: currentDate
    } = getRashifalDateText();

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

    const {
      date_en: todayDate
    } = getRashifalDateText();

    // Same Nepali date already completed: reuse cache, never regenerate.
    if (hasValidTodayCache(todayDate)) {
      return res.json({
        status: "success",
        message:
          "आजको राशिफल पहिले नै तयार छ।",
        data: cache.data
      });
    }

    const success =
      await runWorkflow({ reason: "manual" });

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

    const {
      date_en: startupDate
    } = getRashifalDateText();

    // Restart for an already-completed date is a no-op: cache-first
    // runWorkflow returns before scrape/Gemini. It never regenerates
    // the same Nepali date once dailyAttempt marks it done.
    if (!hasValidTodayCache(startupDate)) {
      await runWorkflow({ reason: "startup" });
    } else {
      console.log(
        `✅ ${startupDate} को राशिफल पहिले नै तयार छ। Restart ले Gemini फेरि call गर्दैन।`
      );
    }
  }
);
