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
      timeout: 15000
    });

    const $ = cheerio.load(res.data);

    // Example text: "आज - ०१ माघ २०८२ बिहीबार"
    const dateText = $('h2, h1')
      .filter((i, el) => $(el).text().includes('आज'))
      .first()
      .text()
      .trim();

    if (dateText) return dateText;

    return null;
  } catch {
    return null;
  }
}

/* --------------------------------------------------
   2. Fetch English Horoscope Text
-------------------------------------------------- */
async function fetchEnglishSource() {
  try {
    const res = await axios.get(
      'https://english.hamropatro.com/rashifal',
      { timeout: 20000 }
    );

    const $ = cheerio.load(res.data);
    const text = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > 800) {
      return { text, site: 'Hamro Patro EN' };
    }

    const backup = await axios.get(
      'https://nepalipatro.com.np/en/nepali-rashifal',
      { timeout: 20000 }
    );

    const $b = cheerio.load(backup.data);
    return {
      text: $b('body').text().substring(0, 6000),
      site: 'Nepali Patro EN'
    };
  } catch {
    return null;
  }
}

/* --------------------------------------------------
   3. AI Processing
-------------------------------------------------- */
async function processRasifal() {
  const nepaliDate = await fetchOfficialNepaliDate();
  const source = await fetchEnglishSource();

  if (!nepaliDate || !source) return false;

  const prompt = `
You are a professional Vedic astrologer.

Create DAILY HOROSCOPE in professional English.

RULES:
- No introductions
- EXACTLY 5 sentences per sign
- No lucky color or number inside prediction
- Calculate lucky color and number based on planetary transits
- Use ONLY standard English zodiac names
- Output valid JSON only

JSON FORMAT:
{
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "prediction": "Five sentences.",
      "lucky_color": "Red",
      "lucky_number": 9
    }
  ]
}

SOURCE TEXT:
"${source.text}"
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

    const parsed = JSON.parse(
      aiRes.data.choices[0].message.content
    );

    rasifalCache = {
      date_np: nepaliDate,
      source: `Groq Astrology (${source.site})`,
      generated_at: new Date().toISOString(),
      last_checked: new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Kathmandu'
      }),
      data: parsed.data
    };

    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------
   4. Scheduler
-------------------------------------------------- */
cron.schedule('*/15 0-10 * * *', async () => {
  rasifalCache.last_checked = new Date().toISOString();

  const officialDate = await fetchOfficialNepaliDate();
  if (officialDate && officialDate !== rasifalCache.date_np) {
    await processRasifal();
  }
});

/* --------------------------------------------------
   5. Routes
-------------------------------------------------- */
app.get('/api/rasifal', (req, res) => {
  res.json(rasifalCache);
});

app.get('/api/rasifal/force-update', async (req, res) => {
  const ok = await processRasifal();
  res.json({ success: ok, date_np: rasifalCache.date_np });
});

/* --------------------------------------------------
   6. Start Server
-------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Rasifal server running on ${PORT}`);
  processRasifal();
});
