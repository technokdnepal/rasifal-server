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

// १. वेबसाइटबाट डेटा रिड गर्ने -
async function fetchSourceData() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        const dateString = $('.articleTitle.fullWidth h2').first().text().trim(); 
        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim();
        
        return { dateFromWeb: dateString || "माघ १, २०८२", text: mainText };
    } catch (e) {
        return null;
    }
}

// २. ग्रह र नक्षत्रको आधारमा राशिफल प्रोसेस गर्ने -
async function processRasifal() {
    const source = await fetchSourceData();
    if (!source || source.text.length < 500) return false;

    // ग्रह र नक्षत्रको स्थिति (Celestial Positions) अनुसार रङ र अङ्क निकाल्ने प्रम्प्ट -
    const prompt = `You are an expert Vedic Astrologer. Analyze the provided text and the current positions of celestial bodies (Sun, Moon, and planets) for the date: ${source.dateFromWeb}.
    
    INSTRUCTIONS:
    1. Create a professional 6-sentence prediction for each sign based on the text: "${source.text}".
    2. UNIQUE COLOR/NUMBER: Do NOT copy the color/number from the source. Instead, determine the Lucky Color and Lucky Number by calculating the planetary transits and zodiac lord positions for this specific date.
    3. SPELLING: Use 'वृश्चिक' (NOT बृश्चिक).
    4. Format: Strict JSON.

    JSON STRUCTURE:
    {
      "date_np": "${source.dateFromWeb}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "syllables": "चु, चे, चो, ला, लि, लु, ले, लो, अ",
          "prediction": "...",
          "lucky_color": "Derived from planetary positions",
          "lucky_number": "Derived from celestial alignment"
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
        rasifalCache.source = `Groq Astrology Engine (Celestial Alignment)`;
        rasifalCache.lastChecked = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
        
        return true;
    } catch (err) {
        return false;
    }
}

cron.schedule('*/15 0-10 * * *', async () => {
    const source = await fetchSourceData();
    if (source && source.dateFromWeb !== rasifalCache.date_np) {
        await processRasifal();
    }
});

app.get('/api/rasifal', (req, res) => res.json(rasifalCache));
app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await processRasifal();
    res.json({ success: result, date: rasifalCache.date_np });
});

app.listen(PORT, () => {
    console.log(`🚀 Astrology Server running on port ${PORT}`);
    processRasifal(); 
});
