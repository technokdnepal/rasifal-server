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
    source: "Waiting for 4:00 AM update..." 
};

// १. रेफरेन्स वेबसाइटबाट सफा टेक्स्ट निकाल्ने
async function getWebsiteReference() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        // अनावश्यक कुरा हटाएर मुख्य राशिफल भाग मात्र लिने
        const mainText = $('.desc-card, .item').text().replace(/\s+/g, ' ').trim(); 
        if (mainText.length > 500) return { source: "Hamro Patro", text: mainText };
        
        // ब्याकअप: यदि पहिलो फेल भएमा
        const resBackup = await axios.get('https://www.nepalipatro.com.np/rashifal', config);
        const $backup = cheerio.load(resBackup.data);
        const backupText = $('body').text().replace(/\s+/g, ' ').trim();
        return { source: "Nepali Patro", text: backupText.substring(0, 8000) };
    } catch (e) {
        return null;
    }
}

// २. एआईलाई कडा निर्देशन दिएर राशिफल तयार गर्ने
async function updateRasifal() {
    console.log("⏳ एआईले व्यावसायिक राशिफल तयार गर्दैछ...");
    const reference = await getWebsiteReference();
    if (!reference) return false;

    // एआईलाई अल्छी गर्न नदिने 'Bulletproof' प्रम्प्ट
    const prompt = `You are a professional astrologer. Using the text provided, write a daily horoscope for all 12 signs.
    
    STRICT REQUIREMENTS FOR EACH SIGN:
    1. Write exactly 6 professional sentences. 
    2. Extract specific details (health, finance, work) from the provided text. Do NOT be generic.
    3. MANDATORY: Every single sign MUST end with "Lucky Color: [Color]" and "Lucky Number: [Number]". 
    4. Language: Professional English.
    5. Order: Aries to Pisces.

    JSON FORMAT: { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    
    SOURCE TEXT: ${reference.text}`;

    try {
        // पहिले Gemini प्रयास गर्ने (High Quality)
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data && output.data.length === 12) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = `Google Gemini (${reference.source})`;
            console.log("✅ सफल: जेमिनाईले पूर्ण डेटा तयार गर्यो।");
            return true;
        }
    } catch (e) {
        // Fallback to Groq Llama
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = `Groq Llama (${reference.source})`;
            console.log("✅ सफल: लामाले ब्याकअप डेटा तयार गर्यो।");
            return true;
        } catch (err) {
            return false;
        }
    }
}

// ३. बिहान ४:०० बजेको सेड्युलर
cron.schedule('0 4 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) await updateRasifal();
    res.json(rasifalCache);
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await updateRasifal();
    res.json({ success: result, engine: rasifalCache.source });
});

app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}. Next update at 4:00 AM.`);
    updateRasifal(); 
});
