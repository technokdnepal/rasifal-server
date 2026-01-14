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

// १. अङ्ग्रेजी स्रोतबाट डेटा तान्ने -
async function fetchEnglishSource() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    try {
        const res = await axios.get('https://english.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        
        // मिति तान्ने लजिक: "May" लाई "मेज" हुनबाट जोगाउन सिधै अङ्ग्रेजी नै राख्ने
        let dateTitle = $('.articleTitle.fullWidth h2').first().text().trim();
        if (!dateTitle || dateTitle.toLowerCase().includes('today')) {
            dateTitle = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        }

        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim();
        
        if (mainText.length > 500) {
            return { date: dateTitle, text: mainText, site: "Hamro Patro (EN)" };
        }

        const resBackup = await axios.get('https://nepalipatro.com.np/en/nepali-rashifal', config);
        return { date: dateTitle, text: $('body').text().substring(0, 5000), site: "Nepali Patro (EN)" };
    } catch (e) { return null; }
}

// २. अङ्ग्रेजीमा प्रोसेस गर्ने र रङ/अङ्क छुट्ट्याउने -
async function processRasifal() {
    const source = await fetchEnglishSource();
    if (!source || source.text.length < 500) return false;

    // कडा निर्देशन: अङ्ग्रेजी भाषा र छुट्टै JSON फिल्डहरू
    const prompt = `You are a professional Vedic Astrologer. Analyze: "${source.text}".
    
    STRICT COMMANDS:
    1. LANGUAGE: All "prediction" text MUST be in PROFESSIONAL ENGLISH. No Nepali/Hindi.
    2. START DIRECTLY: No intro phrases. No "Aries born people..." etc.
    3. SENTENCE COUNT: Exactly 4 to 5 long sentences per sign. Expand the meaning to reach this length.
    4. SEPARATE FIELDS: Put "lucky_color" and "lucky_number" in their OWN JSON keys. 
    5. NO DATA IN TEXT: Do NOT mention color or number inside the "prediction" text string.
    6. CELESTIAL ANALYSIS: Calculate UNIQUE color/number based on planetary positions for ${source.date}.
    7. CORRECT SPELLING: Scorpio must be 'वृश्चिक'.
    8. NO SIGN NAMES: Do not include Aries, Taurus, etc. inside the prediction text.

    JSON FORMAT:
    {
      "date_np": "${source.date}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "prediction": "4-5 professional English sentences...",
          "lucky_color": "Standard Color Name",
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

// ३. स्वचालित सेड्युलर र रुटहरू
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
