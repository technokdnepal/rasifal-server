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

// १. अङ्ग्रेजी वेबसाइटहरूबाट डेटा रिडिङ गर्ने -
async function fetchEnglishSource() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    
    try {
        // प्राइमरी: इङ्ग्लिस हाम्रो पात्रो -
        const res = await axios.get('https://english.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        const dateTitle = $('.articleTitle.fullWidth h2').first().text().trim();
        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim();
        
        if (mainText.length > 500) {
            return { date: dateTitle || "Today", text: mainText, site: "Hamro Patro (EN)" };
        }

        // ब्याकअप: इङ्ग्लिस नेपाली पात्रो -
        const resBackup = await axios.get('https://nepalipatro.com.np/en/nepali-rashifal', config);
        const $b = cheerio.load(resBackup.data);
        const bText = $('body').text().replace(/\s+/g, ' ').trim();
        return { date: "Today", text: bText.substring(0, 8000), site: "Nepali Patro (EN)" };
    } catch (e) {
        return null;
    }
}

// २. अङ्ग्रेजी डेटालाई ५-६ वाक्यमा व्याख्या गर्ने -
async function processRasifal() {
    const source = await fetchEnglishSource();
    if (!source || source.text.length < 500) return false;

    const prompt = `You are a professional Astrologer. Read this English horoscope text: "${source.text}".
    
    INSTRUCTIONS:
    1. For each sign, EXPLAIN the prediction in EXACTLY 5 to 6 professional English sentences. (Maximum 6).
    2. Extract/Calculate Lucky Color and Lucky Number based on celestial positions for today. 
    3. Return these as SEPARATE JSON fields, NOT inside the prediction text.
    4. Correct Nepali spelling for Scorpio is 'वृश्चिक'.
    5. Do NOT include syllables like 'चु, चे, चो'.

    JSON STRUCTURE:
    {
      "date_np": "${source.date}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "prediction": "5-6 sentences of explanation in English...",
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
    } catch (err) {
        return false;
    }
}

// ३. राती १२:०५ बाट स्मार्ट अपडेट -
cron.schedule('*/15 0-10 * * *', async () => {
    const source = await fetchEnglishSource();
    if (source && source.date !== rasifalCache.date_np) {
        await processRasifal();
    }
});

app.get('/api/rasifal', (req, res) => res.json(rasifalCache));

app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await processRasifal();
    res.json({ success: result, date: rasifalCache.date_np });
});

app.listen(PORT, () => {
    processRasifal();
});
