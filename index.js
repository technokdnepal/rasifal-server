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

// क्यास स्टोर (Cache Store) -
let rasifalCache = { 
    date_np: null, 
    data: [], 
    source: "Waiting for update...",
    lastChecked: null
};

// १. वेबसाइटबाट नयाँ मिति र टेक्स्ट पढ्ने -
async function fetchSourceData() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        
        // वेबसाइटको प्रस्ट मिति शीर्षक तान्ने (जस्तै: "आज - ०१ माघ २०८२ बिहीबार")
        const dateString = $('.articleTitle.fullWidth h2').first().text().trim(); 
        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim();
        
        return { 
            dateFromWeb: dateString || "माघ १, २०८२", 
            text: mainText,
            source: "Hamro Patro"
        };
    } catch (e) {
        console.error("Scraping Error:", e.message);
        return null;
    }
}

// २. एआई (Groq) प्रयोग गरेर विस्तृत राशिफल तयार पार्ने
async function processRasifal() {
    console.log("⏳ डेटा प्रोसेस हुँदैछ (रङ र अङ्क छुट्ट्याउँदै)...");
    const source = await fetchSourceData();
    if (!source || source.text.length < 500) return false;

    // रङ र अङ्क छुट्टै फिल्डमा राख्न कडा निर्देशन -
    const prompt = `You are a professional Vedic Astrologer. Using the text: "${source.text}", create a daily horoscope.
    
    STRICT RULES:
    1. Language: Professional English.
    2. CORRECT SPELLING: Always use 'वृश्चिक' for Scorpio (NOT बृश्चिक).
    3. JSON STRUCTURE IS MANDATORY: You must return exactly this structure:
    {
      "date_np": "${source.dateFromWeb}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "syllables": "चु, चे, चो, ला, लि, लु, ले, लो, अ",
          "prediction": "Exactly 6 professional sentences here.",
          "lucky_color": "Specific Color Name",
          "lucky_number": "Specific Number"
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
        
        // क्यास अपडेट -
        rasifalCache.date_np = outputJSON.date_np;
        rasifalCache.data = outputJSON.data;
        rasifalCache.source = `Groq Llama (${source.source})`;
        rasifalCache.lastChecked = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kathmandu' });
        
        console.log(`✅ सफलता: ${outputJSON.date_np} को डेटा रङ र अङ्कसहित अपडेट भयो।`);
        return true;
    } catch (err) {
        console.error("❌ एआई इरोर:", err.message);
        return false;
    }
}

// ३. राती १२:०५ बाट हरेक १५ मिनेटमा स्वचालित चेक -
cron.schedule('*/15 0-10 * * *', async () => {
    const source = await fetchSourceData();
    if (source && source.dateFromWeb !== rasifalCache.date_np) {
        await processRasifal();
    }
});

// ४. एपीआई रुटहरू
app.get('/api/rasifal', (req, res) => res.json(rasifalCache));

app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await processRasifal();
    res.json({ success: result, date: rasifalCache.date_np });
});

app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}.`);
    processRasifal(); // सुरुमा एक पटक डेटा तान्ने
});
