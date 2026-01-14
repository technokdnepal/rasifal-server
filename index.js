const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date_np: null, 
    data: [], 
    source: "Waiting for update...",
    lastChecked: null
};

// १. अङ्ग्रेजी स्रोतहरूबाट डेटा रिडिङ -
async function fetchEnglishSource() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    try {
        const res = await axios.get('https://english.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        const dateTitle = $('.articleTitle.fullWidth h2').first().text().trim();
        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim();
        
        if (mainText.length > 500) {
            return { date: dateTitle || "Today", text: mainText, site: "Hamro Patro (EN)" };
        }

        const resBackup = await axios.get('https://nepalipatro.com.np/en/nepali-rashifal', config);
        const $b = cheerio.load(resBackup.data);
        const bText = $('body').text().replace(/\s+/g, ' ').trim();
        return { date: "Today", text: bText.substring(0, 8000), site: "Nepali Patro (EN)" };
    } catch (e) { return null; }
}

// २. ग्रह र नक्षत्रको आधारमा रङ र अङ्क निकाल्ने -
async function processRasifal() {
    const source = await fetchEnglishSource();
    if (!source || source.text.length < 500) return false;

    // कडा निर्देशन: स्रोतको रङ/अङ्क कपी नगर्ने, ग्रहदशा हेरेर नयाँ निकाल्ने -
    const prompt = `You are a Vedic Astrologer. Analyze the text: "${source.text}".
    
    STRICT REQUIREMENTS:
    1. START DIRECTLY: No "Individuals born under..." or "Today is...". Start with the core prediction immediately.
    2. LENGTH: Exactly 4 to 5 sentences per sign.
    3. CELESTIAL ALIGNMENT: Ignore ANY lucky color or number mentioned in the source text.
    4. CALCULATE: Determine a UNIQUE Lucky Color and Lucky Number for each sign by analyzing today's planetary transits (Sun, Moon, Mars, Jupiter, etc.) for ${source.date}.
    5. Correct Nepali spelling for Scorpio is 'वृश्चिक'.
    6. Return ONLY JSON. Do NOT include sign names inside prediction text.

    JSON STRUCTURE:
    {
      "date_np": "${source.date}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "prediction": "Direct prediction text here...",
          "lucky_color": "Celestial Color Name",
          "lucky_number": "Celestial Number"
        }
      ]
    }`;

    try {
        const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: GROQ_MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: "json_object" }
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

        const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
        
        rasifalCache.date_np = outputJSON.date_np;
        rasifalCache.data = outputJSON.data;
        rasifalCache.source = `Groq Astrology Engine (Celestial Data)`;
        rasifalCache.lastChecked = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
        
        return true;
    } catch (err) { return false; }
}

cron.schedule('*/15 0-10 * * *', async () => {
    const source = await fetchEnglishSource();
    if (source && source.date !== rasifalCache.date_np) { await processRasifal(); }
});

app.get('/api/rasifal', (req, res) => res.json(rasifalCache));
app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await processRasifal();
    res.json({ success: result, date: rasifalCache.date_np });
});

app.listen(PORT, () => { processRasifal(); });
