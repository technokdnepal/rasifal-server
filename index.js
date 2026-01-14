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
        headers: { 'User-Agent': 'Mozilla/5.0...' },
        timeout: 20000
    };
    
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        
        // तपाईँले भन्नुभएको "आज - ०१ माघ..." भन्ने मिति तान्ने -
        const dateString = $('.articleTitle.fullWidth h2').text().trim(); 
        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim();
        
        return { 
            dateFromWeb: dateString || new Date().toLocaleDateString('ne-NP'), 
            text: mainText,
            source: "Hamro Patro"
        };
    } catch (e) {
        return null;
    }
}

// २. एआई (Groq) प्रयोग गरेर राशिफल तयार पार्ने -
async function processRasifal() {
    console.log("⏳ नयाँ डेटा फेला पर्यो, एआईले प्रोसेस गर्दैछ...");
    const source = await fetchSourceData();
    if (!source || source.text.length < 500) return false;

    // अङ्ग्रेजीमा एक्सप्लेन गर्ने र अक्षरहरू (Syllables) थप्ने कडा निर्देशन -
    const prompt = `You are a professional astrologer. Extract daily horoscopes from this text: ${source.text}.
    
    STRICT RULES:
    1. Language: Professional English.
    2. Format: Return ONLY JSON.
    3. Syllables: Include Nepali syllables (e.g., चु, चे, चो...) for each sign.
    4. Quality: Write exactly 6 sentences for each prediction.
    
    JSON STRUCTURE:
    {
      "date_np": "${source.dateFromWeb}",
      "data": [
        {
          "sign": "Aries",
          "sign_np": "मेष",
          "syllables": "चु, चे, चो, ला, लि, लु, ले, लो, अ",
          "prediction": "..."
        },
        ... (all 12 signs)
      ]
    }`;

    try {
        const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: GROQ_MODEL,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: "json_object" }
        }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

        const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
        
        // क्यास अपडेट गर्ने -
        rasifalCache.date_np = outputJSON.date_np;
        rasifalCache.data = outputJSON.data;
        rasifalCache.source = `Groq Llama (${source.source})`;
        rasifalCache.lastChecked = new Date().toLocaleString();
        
        console.log(`✅ सफलता: ${outputJSON.date_np} को राशिफल अपडेट भयो।`);
        return true;
    } catch (err) {
        console.error("❌ एआई इरोर:", err.message);
        return false;
    }
}

// ३. 'Smart Polling' - राती १२:०५ बाट हरेक १५ मिनेटमा चेक गर्ने -
cron.schedule('*/15 0-10 * * *', async () => {
    const source = await fetchSourceData();
    if (source && source.dateFromWeb !== rasifalCache.date_np) {
        await processRasifal();
    } else {
        console.log("😴 नयाँ अपडेट अझै आएको छैन, प्रतिक्षा गर्दै...");
    }
});

// ४. एपीआई रुटहरू -
app.get('/api/rasifal', (req, res) => res.json(rasifalCache));

app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await processRasifal();
    res.json({ success: result, current_date: rasifalCache.date_np });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर सञ्चालनमा छ। बन्दरगाह: ${PORT}`);
    processRasifal(); // सुरुमा एक पटक डेटा तान्ने
});
