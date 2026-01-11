const express = require("express");
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

/* ======================
   MANUAL CLEANER
====================== */
function manualCleaner(text) {
  return text
    .replace(/\(.*?\)/g, "")
    .replace(/चु|चे|चो|ला|लि|लु|ले|लो/gi, "")
    .replace(/Aries|Taurus|Gemini|Cancer|Leo|Virgo|Libra|Scorpio|Sagittarius|Capricorn|Aquarius|Pisces/gi, "")
    .replace(/शुभ रंग.*$/gi, "")
    .replace(/शुभ अंक.*$/gi, "")
    .replace(/[:\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ======================
   GEMINI (OPTIONAL)
====================== */
async function aiClean(sign, text) {
  if (!genAI) return manualCleaner(text);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
${sign} राशिको तलको भविष्यवाणीलाई
२–३ वाक्यमा सरल, शुद्ध नेपाली भाषामा लेख।
नाम, चु-चे-चो, शुभ रंग/अंक हटाऊ।
केवल राशिफल मात्र देऊ।

INPUT:
${text}
`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch {
    return manualCleaner(text);
  }
}

/* ======================
   EKANTIPUR SCRAPER
====================== */
async function scrapeEkantipur() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  await page.goto("https://ekantipur.com/horoscope", {
    waitUntil: "networkidle2",
    timeout: 30000,
  });

  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  let data = [];

  $(".item").each((_, el) => {
    const sign = $(el).find("h2,h3").first().text().trim();
    const text = $(el).find("p").text().trim();
    if (sign && text.length > 40) {
      data.push({ sign, text });
    }
  });

  if (data.length < 6) {
    throw new Error("Ekantipur parsing failed");
  }

  return data;
}

/* ======================
   API
====================== */
app.get("/api/rasifal", async (req, res) => {
  try {
    const raw = await scrapeEkantipur();
    let final = [];

    for (const item of raw) {
      const cleaned = await aiClean(item.sign, item.text);
      final.push({
        sign: item.sign,
        prediction: cleaned,
      });
    }

    res.json({
      status: "SUCCESS",
      source: "EKANTIPUR (Puppeteer)",
      data: final,
    });
  } catch (e) {
    res.status(500).json({
      status: "ERROR",
      message: "राशिफल अपडेट गर्न सकिएन",
      detail: e.message,
    });
  }
});

app.get("/", (_, res) => res.send("✅ Rasifal Server Online"));
app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
