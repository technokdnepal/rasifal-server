/**
 * Horoscope Aggregation & AI Interpretation Server
 * Timezone: Asia/Kathmandu
 */

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
   1. Fetch English Horoscope Source
-------------------------------------------------- */
async function fetchEnglishSource() {
  const config = {
    timeout: 20000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  };

  try {
    // Primary Source
    const res = await axios.get(
      'https://english.hamropatro.com/rashifal',
      config
    );
    const $ = cheerio.load(res.data);

    const dateText =
      $('.articleTitle h2').first().text().trim() ||
      new Date().toDateString();

    const bodyText = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    if (bodyText.length > 800) {
      return {
        date: dateText,
        text: bodyText,
        site: 'Hamro Patro EN'
      };
    }

    // Backup Source
    const backup = await axios.get(
      'https://nepalipatro.com.np/en/nepali-rashifal',
      config
    );
    const $b = cheerio.load(backup.data);

    return {
      date: dateText,
      text: $b('body').text().substring(0, 6000),
      site: 'Nepali Patro EN'
    };
  } catch (err) {
    return null;
  }
}

/* --------------------------------------------------
   2. Process Horoscope via Groq AI
-------------------------------------------------- */
async function processRasifal() {
  const source = await fetchEnglishSource();
  if (!source || source.text.length < 600) return false;

  const prompt = `
You are a professional Vedic astrologer.

Analyze the following source text and create a DAILY HOROSCOPE.

SOURCE TEXT:
"${source.text}"

STRICT RULES:
1. START IMMEDIATELY. No introduction phrases.
2. EXACTLY 5 professional English sentences per sign.
3. NO lucky color or number inside prediction text.
4. Calculate UNIQUE lucky_color and lucky_number for each sign based on planetary transits for ${source.date}.
5. Use ONLY these sign names:
Aries, Taurus, Gemini, Cancer, Leo, Virgo, Libra, Scorpio, Sagittarius, Capricorn, Aquarius, Pisces
6. Language must be professional, simple English.
7. Content must NOT copy the source text.
8. Output MUST be valid JSON only.

JSON FORMAT:
{
  "date_np": "${source.date}",
  "data": [
    {
      "sign": "Aries",
      "sign_np": "मेष",
      "prediction": "Exactly five sentences.",
      "lucky_color": "Color",
      "lucky_number": 7
    }
  ]
}
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
      date_np: parsed.date_np,
      source: `Groq Astrology (${source.site})`,
      generated_at: new Date().toISOString(),
      last_checked: new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Kathmandu'
      }),
      data: parsed.data
    };

    return true;
  } catch (e) {
    return false;
  }
}

/* --------------------------------------------------
   3. Scheduler (12:05 AM – 10:00 AM every 15 min)
-------------------------------------------------- */
cron.schedule('*/15 0-10 * * *', async () => {
  rasifalCache.last_checked = new Date().toISOString();

  const source = await fetchEnglishSource();
  if (source && source.date !== rasifalCache.date_np) {
    await processRasifal();
  }
});

/* --------------------------------------------------
   4. API Routes
-------------------------------------------------- */
app.get('/api/rasifal', (req, res) => {
  res.json(rasifalCache);
});

app.get('/api/rasifal/force-update', async (req, res) => {
  const ok = await processRasifal();
  res.json({ success: ok, date: rasifalCache.date_np });
});

/* --------------------------------------------------
   5. Server Start
-------------------------------------------------- */
app.listen(PORT, () => {
  console.log(`🚀 Horoscope server running on ${PORT}`);
  processRasifal();
});
