process.env.TZ = 'Asia/Kathmandu';

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = {
  date_np: null,
  source: null,
  generated_at: null,
  last_checked: null,
  data: []
};

/* --------------------------------------------------
   1. Fetch OFFICIAL Nepali Date (Hamro Patro NP)
-------------------------------------------------- */
async function fetchOfficialNepaliDate() {
  try {
    const res = await axios.get('https://hamropatro.com/rashifal', {
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const html = res.data;

    // Regex-based extraction (HTML structure change safe)
    const match = html.match(/आज\s*-\s*[०-९]+\s*[^\s]+\s*[०-९]{4}\s*[^\s<]+/);

    if (match && match[0]) {
      return match[0].trim();
    }

    return null;
  } catch (err) {
    console.error('Nepali date fetch failed');
    return null;
  }
}

/* --------------------------------------------------
   2. Fetch English Horoscope Text
-------------------------------------------------- */
const NepaliDate = require('nepali-date-converter');

function getOfficialNepaliDate() {
  const nd = new NepaliDate(new Date());

  const nepaliDays = [
    'आइतबार','सोमबार','मंगलबार','बुधबार',
    'बिहीबार','शुक्रबार','शनिबार'
  ];

  const nepaliMonths = [
    'बैशाख','जेठ','असार','साउन','भदौ','असोज',
    'कात्तिक','मंसिर','पुष','माघ','फागुन','चैत'
  ];

  const day = nepaliDays[new Date().getDay()];

  return `आज - ${nd.getDate()} ${nepaliMonths[nd.getMonth()]} ${nd.getYear()} ${day}`;
}

/* --------------------------------------------------
   3. AI Processing
-------------------------------------------------- */
async function processRasifal() {
  const nepaliDate = await fetchOfficialNepaliDate();
  const source = await fetchEnglishSource();

  if (!nepaliDate || !source) {
    console.error("❌ डेटा अपुरो छ, एआईलाई बोलाउन सकिएन।");
    return false;
  }

  const prompt = `
  You are a professional Vedic astrologer.
  Create DAILY HOROSCOPE for date ${nepaliDate} in professional English based on this text: "${source.text}".

  RULES:
  - Start directly with the prediction.
  - Exactly 5 professional sentences per sign.
  - No lucky color or number inside prediction text.
  - Calculate UNIQUE lucky color and number based on today's planets.
  - Spelling for Scorpio: 'वृश्चिक'.
  - Output ONLY valid JSON.

  JSON FORMAT:
  {
    "data": [
      {
        "sign": "Aries",
        "sign_np": "मेष",
        "prediction": "5 sentences.",
        "lucky_color": "Red",
        "lucky_number": 9
      }
    ]
  }`;

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
      source: `Groq Astrology (${source.site})`,
      generated_at: new Date().toISOString(),
      last_checked: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' }),
      data: parsed.data
    };

    console.log("✅ राशिफल सफलतापूर्वक अपडेट भयो:", nepaliDate);
    return true;
  } catch (err) {
    console.error("❌ एआई प्रोसेसिङ इरोर:", err.response?.data || err.message);
    return false;
  }
}

/* --------------------------------------------------
   4. Routes & Scheduler
-------------------------------------------------- */
cron.schedule('*/15 0-10 * * *', async () => {
  console.log("⏳ स्वचालित चेक गर्दै...");
  const officialDate = await fetchOfficialNepaliDate();
  if (officialDate && officialDate !== rasifalCache.date_np) {
    await processRasifal();
  }
});

app.get('/api/rasifal', (req, res) => res.json(rasifalCache));

app.get('/api/rasifal/force-update', async (req, res) => {
  const ok = await processRasifal();
  res.json({ success: ok, message: ok ? "Updated" : "Failed - Check Logs", date_np: rasifalCache.date_np });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  processRasifal(); 
});
