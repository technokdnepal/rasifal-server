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

// २. एआईलाई सिधै र छोटो बनाउन कडा निर्देशन -
async function processRasifal() {
    const source = await fetchEnglishSource();
    if (!source || source.text.length < 500) return false;

    const prompt = `You are a concise Vedic Astrologer. Read this English text: "${source.text}".
    
    STRICT RULES:
    1. START DIRECTLY: Do NOT use introductory phrases like "Individuals born under...", "For Aries today...", or "Today brings...". 
    2. Start the prediction with the core action or outcome immediately (e.g., "Expect significant success after a period of struggle.").
    3. LENGTH: Exactly 4 to 5 sentences per sign.
    4. NO LABELS: Do not include the sign name (Aries, मेष, etc.) inside the prediction text.
    5. LANGUAGE: Professional English.
    6. SEPARATE FIELDS: Lucky Color and Number must be in their own fields based on celestial alignment.
    7. Correct Nepali spelling for Scorpio is 'वृश्चिक'.

    JSON STRUCTURE:
    {
      "date_np": "${source.date}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "prediction": "Direct 4-5 sentences only...",
          "lucky_color": "Color Name",
          "lucky_number": "Number"
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
        rasifalCache.source = `Groq Astrology (${source.site})`;
        rasifalCache.lastChecked = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
        
        return true;
    } catch (err) { return false; }
}

// ३. राती १२:०५ बाट स्मार्ट अपडेट -
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
