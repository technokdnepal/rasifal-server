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
    const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
    const $ = cheerio.load(res.data);

    // बलियो लजिक: क्लास प्रयोग गरेर मिति तान्ने -
    const dateText = $('.articleTitle.fullWidth h2').first().text().trim() || 
                     $('h2:contains("आज")').text().trim();

    if (dateText) return dateText;
    console.error("❌ मिति भेटिएन: Selector मिलेन");
    return null;
  } catch (err) {
    console.error("❌ नेपाली मिति तान्न सकिएन:", err.message);
    return null;
  }
}

/* --------------------------------------------------
   2. Fetch English Horoscope Text
-------------------------------------------------- */
async function fetchEnglishSource() {
  try {
    const res = await axios.get('https://english.hamropatro.com/rashifal', { timeout: 20000 });
    const $ = cheerio.load(res.data);
    const text = $('.desc-card, .item, body').text().replace(/\s+/g, ' ').trim();

    if (text.length > 800) {
      return { text, site: 'Hamro Patro EN' };
    }

    console.log("⚠️ अंग्रेजी हाम्रो पात्रोमा डेटा कम छ, ब्याकअप प्रयोग गर्दै...");
    const backup = await axios.get('https://nepalipatro.com.np/en/nepali-rashifal', { timeout: 20000 });
    const $b = cheerio.load(backup.data);
    return { text: $b('body').text().substring(0, 6000), site: 'Nepali Patro EN' };
  } catch (err) {
    console.error("❌ अंग्रेजी स्रोत तान्न सकिएन:", err.message);
    return null;
  }
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
