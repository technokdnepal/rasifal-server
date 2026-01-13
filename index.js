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
    source: "डेटा लोड हुँदैछ..." 
};

// १. स्क्र्यापर
async function getRawData() {
    try {
        console.log("🌐 हाम्रो पात्रोबाट डेटा तान्दै...");
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item').each((i, el) => {
            const title = $(el).find('.title').text().trim();
            const desc = $(el).find('.desc').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });
        console.log("✅ स्क्र्यापिङ सफल भयो।");
        return content;
    } catch (e) {
        console.error("❌ स्क्र्यापिङमा समस्या:", e.message);
        return null;
    }
}

// २. मुख्य एआई कार्यविधि
async function updateRasifal() {
    const rawData = await getRawData();
    if (!rawData) {
        rasifalCache.source = "Scraping Error";
        return false;
    }

    const prompt = `You are a professional astrologer for technokd.com. 
    TASK: Translate the following Nepali horoscope data into detailed English (6 sentences each sign).
    FORMAT: { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    DATA: ${rawData}`;

    // Gemini प्रयास
    try {
        console.log(`🚀 Gemini (${GEMINI_MODEL}) बाट प्रयास गर्दै...`);
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        }, { timeout: 30000 });

        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = "Google Gemini (English)";
            console.log("✅ सफल: जेमिनाईले अङ्ग्रेजी डेटा दियो।");
            return true;
        }
    } catch (e) {
        console.error("❌ Gemini Error Details:", e.response ? JSON.stringify(e.response.data) : e.message);
        
        // Fallback to Groq Llama
        console.log("🔄 अब Groq (Llama) बाट प्रयास गर्दै...");
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { 
                headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
                timeout: 30000 
            });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = "Groq Llama (English)";
            console.log("✅ सफल: लामाले अङ्ग्रेजी डेटा दियो।");
            return true;
        } catch (err) {
            console.error("❌ Groq Error Details:", err.response ? JSON.stringify(err.response.data) : err.message);
            rasifalCache.source = "एआई इन्जिन फेल भयो";
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

// फोर्स अपडेट एण्डपोइन्ट
app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await updateRasifal();
    res.json({ success: result, engine: rasifalCache.source });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो।`);
    updateRasifal();
});
