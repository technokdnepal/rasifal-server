const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

// १. टाइमजोन र सर्भर सेटिङ
process.env.TZ = 'Asia/Kathmandu';
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// २. Environment Variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "Waiting for 4:00 AM update..." 
};

// ३. बहु-स्रोत स्क्र्यापर (Hamro Patro + Nepali Patro)
async function getRawData() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 15000
    };
    
    // प्रयास १: हाम्रो पात्रो
    try {
        console.log("🌐 हाम्रो पात्रोबाट डेटा तान्दै...");
        const res = await axios.get('https://www.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item, .desc-card').each((i, el) => {
            const title = $(el).find('.title, h2').text().trim();
            const desc = $(el).find('.desc, p').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });
        if (content.length > 300) return { source: "Hamro Patro", text: content };
    } catch (e) {
        console.warn("⚠️ हाम्रो पात्रोमा समस्या, ब्याकअपमा जाँदै...");
    }

    // प्रयास २: नेपाली पात्रो (Backup)
    try {
        console.log("🌐 नेपाली पात्रोबाट डेटा तान्दै...");
        const res = await axios.get('https://www.nepalipatro.com.np/rashifal', config);
        const $ = cheerio.load(res.data);
        let content = "";
        $('.horoscope-sign-info, .card').each((i, el) => {
            const title = $(el).find('h2, .title').text().trim();
            const desc = $(el).find('p, .description').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });
        if (content.length > 300) return { source: "Nepali Patro", text: content };
    } catch (e) {
        return null;
    }
}

// ४. मुख्य एआई कार्यविधि (English Professional Explainer)
async function updateRasifal() {
    console.log("⏳ अङ्ग्रेजीमा राशिफलको व्यावसायिक व्याख्या तयार हुँदैछ...");
    const rawDataObj = await getRawData();
    if (!rawDataObj) {
        rasifalCache.source = "Scraping Failed on all sources";
        return false;
    }

    const prompt = `You are a professional English Astrologer. 
    Using the Nepali horoscope data from ${rawDataObj.source}, explain each of the 12 zodiac signs in 5-6 detailed, meaningful English sentences.
    Ensure 100% accuracy in meaning. Include lucky color and number at the end of each prediction.
    
    JSON FORMAT ONLY: { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    DATA: ${rawDataObj.text}`;

    // Gemini प्रयास
    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = `Google Gemini (${rawDataObj.source})`;
            console.log("✅ सफल: जेमिनाईले अङ्ग्रेजी व्याख्या तयार गर्यो।");
            return true;
        }
    } catch (e) {
        // Fallback to Groq Llama (अङ्ग्रेजीका लागि उत्कृष्ट)
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = `Groq Llama (${rawDataObj.source})`;
            return true;
        } catch (err) {
            return false;
        }
    }
}

// ५. सेड्युलर (बिहान ठ्याक्कै ४:०० बजे अपडेट हुने गरी सेट गरिएको)
// '0 4 * * *' को अर्थ हो - 0 मिनेट, 4 घण्टा (4 AM)
cron.schedule('0 4 * * *', updateRasifal);

// ६. एण्डपोइन्ट्स
app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await updateRasifal();
    }
    res.json(rasifalCache);
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await updateRasifal();
    res.json({ success: result, engine: rasifalCache.source });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो। अर्को अपडेट बिहान ४ बजे हुनेछ।`);
    updateRasifal(); 
});
