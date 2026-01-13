const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// =======================
// In-Memory Cache
// =======================
let rasifalCache = {
  date: null,
  data: null,
  source: null
};

// =======================
// Utility – Nepal Date
// =======================
const todayNepal = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });

// =======================
// Scrape Hamro Patro
// =======================
async function scrapeHamroPatro() {
  const res = await axios.get('https://www.hamropatro.com/rashifal', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  });

  const $ = cheerio.load(res.data);
  const out = [];

  $('.item').each((_, el) => {
    const sign = $(el).find('h3').text().trim();
    const text = $(el).find('.desc p').text().trim();
    if (sign && text.length > 30) {
      out.push({ sign, text });
    }
  });

  return out;
}

// =======================
// Scrape Nepali Patro
// =======================
async function scrapeNepaliPatro() {
  const res = await axios.get('https://nepalipatro.com.np/rashifal', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 15000
  });

  const $ = cheerio.load(res.data);
  const out = [];

  $('.rashifal-item').each((_, el) => {
    const sign = $(el).find('h3').text().trim();
    const text = $(el).find('p').text().trim();
    if (sign && text.length > 30) {
      out.push({ sign, text });
    }
  });

  return out;
}

// =======================
// Groq AI – Clean Nepali
// =======================
async function cleanWithGroq(rawData) {
  const prompt = `
तपाईं एक अनुभवी नेपाली भाषा सम्पादक र ज्योतिषी हुनुहुन्छ।
दुई वेबसाइटबाट आएको कच्चा राशिफललाई अत्यन्तै शुद्ध, सरल
र २–३ वाक्यको प्राकृतिक नेपाली बनाउनुहोस्।

OUTPUT JSON मात्र:
{
  "data": [
    { "sign": "मेष", "prediction": "..." }
  ]
}

RAW INPUT:
${JSON.stringify(rawData, null, 2)}
`;

  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: 'mixtral-8x7b-32768',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    },
    {
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return JSON.parse(res.data.choices[0].message.content).data;
}

// =======================
// Cron Job – 12:10 AM Nepal
// =======================
cron.schedule(
  '10 0 * * *',
  async () => {
    console.log('⏰ 12:10 AM – Updating Rasifal');

    try {
      const [hamro, nepali] = await Promise.all([
        scrapeHamroPatro(),
        scrapeNepaliPatro()
      ]);

      const clean = await cleanWithGroq([...hamro, ...nepali]);

      rasifalCache = {
        date: todayNepal(),
        data: clean,
        source: 'Hamro Patro + Nepali Patro + Groq AI'
      };

      console.log('✅ Rasifal Updated');
    } catch (err) {
      console.error('❌ Rasifal Update Failed:', err.message);
    }
  },
  { timezone: 'Asia/Kathmandu' }
);

// =======================
// API
// =======================
app.get('/api/rasifal', (req, res) => {
  if (!rasifalCache.data) {
    return res.status(503).json({
      status: 'ERROR',
      message: 'राशिफल अपडेट गर्न सकिएन'
    });
  }

  res.json({
    status: 'SUCCESS',
    date: rasifalCache.date,
    source: rasifalCache.source,
    data: rasifalCache.data
  });
});

app.get('/', (req, res) => {
  res.send('Rasifal Server Online 🚀');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
