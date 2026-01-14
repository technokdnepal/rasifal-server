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

async function fetchEnglishSource() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    try {
        const res = await axios.get('https://english.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        // मिति तान्ने अझ भरपर्दो तरिका
        const dateTitle = $('.articleTitle.fullWidth h2').first().text().trim() || 
                          $('.pDate').first().text().trim() || 
                          new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        
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

async function processRasifal() {
    const source = await fetchEnglishSource();
    if (!source || source.text.length < 500) return false;

    const prompt = `You are a professional Vedic Astrologer. Analyze this text: "${source.text}".
    
    CRITICAL RULES (Failure to follow will break the system):
    1. START DIRECTLY: No "Individuals born under..." or intro phrases. Start with the core prediction.
    2. MINIMUM LENGTH: Every sign's prediction MUST be at least 4 long sentences. If the source is short, EXPAND the meaning using your astrological knowledge to reach 4-5 sentences.
    3. NO LABELS: Do not include sign names (Aries, मेष) inside the prediction.
    4. CELESTIAL COLORS & NUMBERS: Ignore the source. Calculate UNIQUE lucky colors and numbers based on planetary transits for ${source.date}. Use standard color names (e.g., Deep Red, Navy Blue).
    5. CORRECT SPELLING: Scorpio must be 'वृश्चिक'.
    6. DATE: Use the exact date: "${source.date}".

    JSON STRUCTURE:
    {
      "date_np": "...",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "prediction": "4 to 5 detailed sentences explaining the daily outlook...",
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
