// const cron = require('node-cron');

// cron.schedule('10 0 * * *', () => {
//   generateDailyRasifal();
// });const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// =======================
// 1️⃣ In-Memory Cache
// =======================
let rasifalCache = {
  date: null,
  data: null,
  source: null
};

// =======================
// 2️⃣ Utility
// =======================
const todayNepal = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });

// =======================
// 3️⃣ Scrape Hamro Patro
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
// 4️⃣ Scrape Nepali Patro
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
// 5️⃣ Groq AI – Clean Nepali
// =======================
async function cleanWithGroq(rawData) {
  const prompt = `
तपाईं एक अनुभवी नेपाली भाषा सम्पादक र ज्योतिषी हुनुहुन्छ।

तल दुई वेबसाइट (हाम्रो पात्र र नेपाली पात्रो) बाट आएको कच्चा राशिफल डाटा छ।
तपाईंको काम:

- अत्यन्तै शुद्ध, सरल र सबै नेपालीले बुझ्ने भाषा प्रयोग गर्ने
- कुनै पनि गलत शब्द, अनावश्यक दोहोरिने वाक्य हटाउने
- "चु, चे, चो", "शुभ रंग", "शुभ अंक" जस्ता कुरा नराख्ने
- प्रत्येक राशिको भविष्यवाणी २–३ वाक्य मात्र
- अत्यन्तै प्राकृतिक नेपाली (FM Radio / Newspaper style)
- कुनै पनि हिन्दी, अंग्रेजी, मेशिन जस्तो भाषा प्रयोग नगर्ने

OUTPUT अनिवार्य रूपमा JSON मात्र हुनुपर्छ:
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
      },
      timeout: 20000
    }
  );

  return JSON.parse(res.data.choices[0].message.content).data;
}

// =======================
// 6️⃣ Daily Job – 12:10 AM
// =======================
cron.schedule(
  '10 0 * * *',
  async () => {
    console.log('⏰ 12:10 AM – Daily Rasifal Update');

    try {
      const [hamro, nepali] = await Promise.all([
        scrapeHamroPatro(),
        scrapeNepaliPatro()
      ]);

      const combined = [...hamro, ...nepali];
      const clean = await cleanWithGroq(combined);

      rasifalCache = {
        date: todayNepal(),
        data: clean,
        source: 'HAMRO_PATRO + NEPALI_PATRO + GROQ'
      };

      console.log('✅ Rasifal Updated Successfully');
    } catch (e) {
      console.error('❌ Daily Update Failed:', e.message);
    }
  },
  { timezone: 'Asia/Kathmandu' }
);

// =======================
// 7️⃣ API Endpoint
// =======================
app.get('/api/rasifal', (req, res) => {
  if (!rasifalCache.data) {
    return res.status(503).json({
      status: 'ERROR',
      message: 'Rasifal not generated yet. Please wait till 12:10 AM.'
    });
  }

  res.json({
    status: 'SUCCESS',
    date: rasifalCache.date,
    source: rasifalCache.source,
    data: rasifalCache.data
  });
});

app.get('/', (req, res) => res.send('Rasifal Server Online 🚀'));

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
