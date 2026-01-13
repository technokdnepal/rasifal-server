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

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "Data Loading..." 
};

// १. बहु-स्रोत स्क्र्यापिङ (Hamro Patro + Nepali Patro Backup)
async function getRawData() {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.37' };
    
    // पहिलो प्रयास: हाम्रो पात्रो
    try {
        console.log("🌐 हाम्रो पात्रोबाट डेटा तान्ने प्रयास...");
        const res = await axios.get('https://www.hamropatro.com/rashifal', { headers, timeout: 10000 });
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item').each((i, el) => {
            const title = $(el).find('.title').text().trim();
            const desc = $(el).find('.desc').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });
        if (content.length > 200) return { source: "Hamro Patro", text: content };
    } catch (e) {
        console.warn("⚠️ हाम्रो पात्रो डाउन छ, नेपाली पात्रो प्रयास गर्दै...");
    }

    // दोस्रो प्रयास: नेपाली पात्रो (Backup)
    try {
        console.log("🌐 नेपाली पात्रोबाट डेटा तान्ने प्रयास...");
        const res = await axios.get('https://www.nepalipatro.com.np/rashifal', { headers, timeout: 10000 });
        const $ = cheerio.load(res.data);
        let content = "";
        // नेपाली पात्रोको वेबसाइट स्ट्रक्चर अनुसारको सेलेक्टर
        $('.horoscope-sign-info').each((i, el) => {
            const title = $(el).find('h2').text().trim();
            const desc = $(el).find('p').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });
        if (content.length > 200) return { source: "Nepali Patro", text: content };
    } catch (e) {
        console.error("❌ दुवै वेबसाइटबाट डेटा तान्न सकिएन।");
        return null;
    }
}

// २. मुख्य एआई कार्यविधि (Professional English Explainer)
async function updateRasifal() {
    const rawDataObj = await getRawData();
    if (!rawDataObj) {
        rasifalCache.source = "Scraping Failed on all sources";
        return false;
    }

    const prompt = `You are a professional English Astrologer for 'technokd.com'.
    TASK: Using the provided raw data from ${rawDataObj.source}, EXPLAIN each of the 12 zodiac signs in 5-6 detailed, professional English sentences.
    
    STRICT RULES:
    1. Sentence Count: Write exactly 5 to 6 meaningful sentences for each sign.
    2. Meaning: Keep the core meaning 100% correct from the source.
    3. Output: Provide ONLY valid JSON. No extra text.
    
    JSON FORMAT: { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    DATA: ${rawDataObj.text}`;

    // Gemini प्रयास
    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        }, { timeout: 30000 });

        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data && output.data.length === 12) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = `Google Gemini (via ${rawDataObj.source})`;
            console.log(`✅ सफल: अङ्ग्रेजी व्याख्या तयार भयो (${rawDataObj.source} बाट)।`);
            return true;
        }
    } catch (e) {
        console.error("❌ Gemini Error:", e.response ? JSON.stringify(e.response.data) : e.message);
        
        // Groq Llama Fallback
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 30000 });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = `Groq Llama (via ${rawDataObj.source})`;
            return true;
        } catch (err) {
            return false;
        }
    }
}

cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await updateRasifal();
    }
    res.json(rasifalCache);
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR", engine: rasifalCache.source });
});

app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    updateRasifal(); 
});
