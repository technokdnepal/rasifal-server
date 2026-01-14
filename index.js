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

// १. अङ्ग्रेजी स्रोतहरूबाट डेटा रिडिङ - मिति तान्ने लजिक सुधारिएको छ
async function fetchEnglishSource() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    try {
        const res = await axios.get('https://english.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        
        // "Today" मात्र नभई वास्तविक मिति तान्ने प्रयास
        let dateTitle = $('.articleTitle.fullWidth h2').first().text().trim() || 
                        $('.pDate').first().text().trim();
        
        // यदि वेबसाइटबाट मिति आएन भने आजको अंग्रेजी मिति राख्ने
        if (!dateTitle || dateTitle.toLowerCase() === 'today') {
            dateTitle = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        }

        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim();
        
        if (mainText.length > 500) {
            return { date: dateTitle, text: mainText, site: "Hamro Patro (EN)" };
        }

        const resBackup = await axios.get('https://nepalipatro.com.np/en/nepali-rashifal', config);
        const $b = cheerio.load(resBackup.data);
        const bText = $('body').text().replace(/\s+/g, ' ').trim();
        return { date: dateTitle, text: bText.substring(0, 8000), site: "Nepali Patro (EN)" };
    } catch (e) { return null; }
}

// २. एआईलाई ४-५ वाक्य पुर्याउन र सिधै सुरु गर्न कडा निर्देशन
async function processRasifal() {
    const source = await fetchEnglishSource();
    if (!source || source.text.length < 500) return false;

    // CRITICAL RULES: वाक्य संख्या र व्याख्याको गहिराइ थपिएको छ
    const prompt = `You are a professional Vedic Astrologer. Read this English text: "${source.text}".
    
    STRICT AND CRITICAL RULES:
    1. START DIRECTLY: No introductory phrases like "Individuals born under...", "For Aries today...", or "Today brings...". Start with the core prediction immediately.
    2. MINIMUM LENGTH: Every sign's prediction MUST be at least 4 to 5 long sentences. If the source text is short, EXPAND and explain the meaning using your astrological expertise to reach this length.
    3. NO LABELS: Do not include the sign name inside the prediction text.
    4. CELESTIAL ALIGNMENT: Ignore any lucky color or number in the source text. Instead, CALCULATE a UNIQUE Lucky Color and Lucky Number for each sign based on planetary transits (Sun, Moon, Mars, Jupiter) specifically for the date: ${source.date}. Use standard color names (e.g., Navy Blue, Deep Red).
    5. LANGUAGE: Professional English.
    6. Correct Nepali spelling for Scorpio is 'वृश्चिक'.

    JSON STRUCTURE:
    {
      "date_np": "${source.date}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "prediction": "Exactly 4-5 detailed sentences explaining the outlook...",
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

// ३. राती १२:०५ बाट स्मार्ट अपडेट
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
