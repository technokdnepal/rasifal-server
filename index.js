/**
 * Rasifal Server - FINAL STABLE VERSION
 * Author: technokdnepal
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
const NepaliDate = require('nepali-date-converter');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

/* ===================== CONFIG ===================== */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

/* ===================== CACHE ===================== */

let rasifalCache = {
  date_np: null,
  source: null,
  generated_at: null,
  last_checked: null,
  data: []
};

/* ===================== NEPALI DATE ===================== */

function getOfficialNepaliDate() {
  const nd = new NepaliDate(new Date());

  const days = [
    'आइतबार','सोमबार','मंगलबार',
    'बुधबार','बिहीबार','शुक्रबार','शनिबार'
  ];

  const months = [
    'बैशाख','जेठ','असार','साउन','भदौ','असोज',
    'कात्तिक','मंसिर','पुष','माघ','फागुन','चैत'
  ];

  return `आज - ${nd.getDate()} ${months[nd.getMonth()]} ${nd.getYear()} ${days[new Date().getDay()]}`;
}

/* ===================== SCRAPE ENGLISH SOURCE ===================== */

async function fetchEnglishSource() {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  };

  try {
    const res = await axios.get(
      'https://english.hamropatro.com/rashifal',
      { headers, timeout: 20000 }
    );

    const $ = cheerio.load(res.data);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    if (text.length > 1000) {
      return { text, site: 'Hamro Patro (EN)' };
    }
  } catch (_) {}

  // Backup
  try {
    const res = await axios.get(
      'https://nepalipatro.com.np/en/nepali-rashifal',
      { headers, timeout: 20000 }
    );
    const $ = cheerio.load(res.data);
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    if (text.length > 1000) {
      return { text, site: 'Nepali Patro (EN)' };
    }
  } catch (_) {}

  return null;
}

/* ===================== AI PROCESS ===================== */

async function processRasifal() {
  console.log('⏳ Checking rasifal update...');

  const nepaliDate = getOfficialNepaliDate();
  const source = await fetchEnglishSource();

  rasifalCache.last_checked = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kathmandu'
  });

  if (!source) {
    console.log('❌ Source unavailable');
    return false;
  }

  if (rasifalCache.date_np === nepaliDate && rasifalCache.data.length) {
    console.log('✅ Already updated for today');
    return true;
  }

  const prompt = `
You are a professional Vedic astrologer.

TASK:
Write daily horoscope for all 12 zodiac signs.

STRICT RULES:
1. Professional Indian-style English only
2. NO introductions like "For Aries today..."
3. EXACTLY 5 sentences per sign
4. Explain meaning in your own words
5. DO NOT mention lucky color/number inside prediction
6. Calculate UNIQUE lucky_color and lucky_number based on planetary transits
7. Zodiac names in English only

OUTPUT JSON ONLY:
{
  "data":[
    {
      "sign":"Aries",
      "sign_np":"मेष",
      "prediction":"Exactly five sentences...",
      "lucky_color":"Color",
      "lucky_number":"Number"
    }
  ]
}

SOURCE TEXT:
${source.text.substring(0, 8000)}
`;

  try {
    const aiRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.6,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const parsed = JSON.parse(aiRes.data.choices[0].message.content);

    rasifalCache = {
      date_np: nepaliDate,
      source: `Groq AI (${source.site})`,
      generated_at: new Date().toISOString(),
      last_checked: rasifalCache.last_checked,
      data: parsed.data || []
    };

    console.log('✅ Rasifal generated successfully');
    return true;
  } catch (err) {
    console.log('❌ AI Error', err.message);
    return false;
  }
}

/* ===================== CRON ===================== */

cron.schedule('*/15 0-10 * * *', async () => {
  await processRasifal();
});

/* ===================== API ROUTES ===================== */

app.get('/api/rasifal', (req, res) => {
  res.json(rasifalCache);
});

app.get('/api/rasifal/force-update', async (req, res) => {
  const ok = await processRasifal();
  res.json({ success: ok, date_np: rasifalCache.date_np });
});

/* ===================== START ===================== */

app.listen(PORT, () => {
  console.log(`🚀 Rasifal Server running on port ${PORT}`);
  processRasifal();
});
