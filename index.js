const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

/* =======================
   IN-MEMORY DAILY CACHE
======================= */
let rasifalCache = {
  date: null,
  data: null,
  source: null
};

/* =======================
   UTILS
======================= */
function todayNepal() {
  return new Date().toISOString().split('T')[0];
}

/* =======================
   SCRAPERS
======================= */
async function scrapeHamroPatro() {
  const { data } = await axios.get('https://www.hamropatro.com/rashifal');
  const $ = cheerio.load(data);
  const list = [];

  $('.item').each((i, el) => {
    const sign = $(el).find('.title').text().trim();
    const prediction = $(el).find('.desc').text().trim();
    if (sign && prediction) list.push({ sign, prediction });
  });

  return list;
}

async function scrapeNepaliPatro() {
  const { data } = await axios.get('https://www.nepalipatro.com.np/rashifal');
  const $ = cheerio.load(data);
  const list = [];

  $('.rashifal-item').each((i, el) => {
    const sign = $(el).find('h3').text().trim();
    const prediction = $(el).find('p').text().trim();
    if (sign && prediction) list.push({ sign, prediction });
  });

  return list;
}

/* =======================
   GROQ CLEANER
======================= */
async function cleanWithGroq(rawData) {
  const prompt = `
तल दिइएको राशिफल डाटालाई
- शुद्ध
- सरल
- सबै नेपालीले बुझ्ने
- कुनै बनावटी शब्द बिना
पुनर्लेखन गर्नुहोस्।

JSON मात्र output गर्नुहोस्।

FORMAT:
{
 "data":[
  {"sign":"मेष","prediction":"..."}
 ]
}

DATA:
${JSON.stringify(rawData)}
`;

  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
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

/* =======================
   STATIC BACKUP
======================= */
const STATIC_BACKUP = [
  { sign: 'मेष', prediction: 'आज आत्मविश्वास बढ्नेछ।' },
  { sign: 'वृष', prediction: 'धन लाभको संकेत छ।' },
  { sign: 'मिथुन', prediction: 'सम्बन्ध मजबुत हुनेछन्।' },
  { sign: 'कर्कट', prediction: 'स्वास्थ्यमा ध्यान दिनुहोस्।' },
  { sign: 'सिंह', prediction: 'मान–सम्मान बढ्नेछ।' },
  { sign: 'कन्या', prediction: 'धैर्यले सफलता दिलाउनेछ।' },
  { sign: 'तुला', prediction: 'आर्थिक पक्ष बलियो रहनेछ।' },
  { sign: 'वृश्चिक', prediction: 'निर्णय सोचेर लिनुहोस्।' },
  { sign: 'धनु', prediction: 'यात्राको योग छ।' },
  { sign: 'मकर', prediction: 'पुराना काम पूरा हुनेछन्।' },
  { sign: 'कुम्भ', prediction: 'नयाँ अवसर प्राप्त हुनेछ।' },
  { sign: 'मीन', prediction: 'मानसिक शान्ति मिल्नेछ।' }
];

/* =======================
   DAILY UPDATE (12:10 AM)
======================= */
cron.schedule('10 0 * * *', async () => {
  try {
    console.log('🌙 Daily Rasifal Update Started');

    const [hamro, nepali] = await Promise.all([
      scrapeHamroPatro(),
      scrapeNepaliPatro()
    ]);

    const cleaned = await cleanWithGroq([...hamro, ...nepali]);

    rasifalCache = {
      date: todayNepal(),
      data: cleaned,
      source: 'Hamro Patro + Nepali Patro + Groq AI'
    };

    console.log('✅ Rasifal Updated Successfully');
  } catch (e) {
    console.error('❌ Daily Update Failed:', e.message);
  }
});

/* =======================
   API ENDPOINTS
======================= */
app.get('/api/rasifal', (req, res) => {
  if (!rasifalCache.data) {
    return res.status(503).json({
      status: 'ERROR',
      message: 'राशिफल अपडेट गर्न सकिएन'
    });
  }

  res.json({
    status: 'SUCCESS',
    source: rasifalCache.source,
    date: rasifalCache.date,
    data: rasifalCache.data
  });
});

/* Manual emergency update */
app.get('/api/rasifal/force-update', async (req, res) => {
  try {
    const [hamro, nepali] = await Promise.all([
      scrapeHamroPatro(),
      scrapeNepaliPatro()
    ]);

    const cleaned = await cleanWithGroq([...hamro, ...nepali]);

    rasifalCache = {
      date: todayNepal(),
      data: cleaned,
      source: 'Manual Force Update'
    };

    res.json({ status: 'SUCCESS' });
  } catch (e) {
    res.status(500).json({
      status: 'ERROR',
      fallback: STATIC_BACKUP
    });
  }
});

app.get('/', (_, res) =>
  res.send('✅ Rasifal Server Running (Daily Stable Mode)')
);

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
