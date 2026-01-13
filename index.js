const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

// १. टाइमजोन सेटिङ
process.env.TZ = process.env.TZ || 'Asia/Kathmandu';

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
    source: "Waiting for update..." 
};

// ३. स्क्र्यापर
async function getRawData() {
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item').each((i, el) => {
            content += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n";
        });
        return content;
    } catch (e) {
        console.error("Scraping error:", e.message);
        return null;
    }
}

// ४. मुख्य एआई इन्जिन (Gemini with Llama Fallback)
async function updateRasifal() {
    console.log("⏳ नयाँ राशिफल तयार हुँदैछ...");
    const rawData = await getRawData();
    if (!rawData) return false;

    // ८बी मोडलका लागि पनि ५-६ वाक्य लेख्न बाध्य पार्ने कडा प्रम्प्ट
    const prompt = `You are a Professional Astrologer for technokd.com.
    TASK: Read the raw Nepali data and WRITE a 6-sentence detailed horoscope for each of the 12 signs in PURE NEPALI.
    
    STRICT RULES:
    1. Sentence Count: You MUST write exactly 6 sentences for each sign.
    2. No Copying: Use your own words. Do not use phrases like "आर्थिक लेनदेनमा सतर्कता".
    3. Natural Tone: Write like a human columnist. 
    4. Language: Pure Nepali only. No Hindi words like 'दरवाजा' or 'अच्छी'.

    JSON FORMAT:
    { "data": [ {"sign": "मेष", "prediction": "Write 6 long sentences here..."}, ... ] }
    
    DATA: ${rawData}`;

    // ५. Gemini प्रयास (responseMimeType फिक्स गरिएको)
    try {
        console.log(`🚀 ${GEMINI_MODEL} बाट प्रयास गर्दै...`);
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { 
                responseMimeType: "application/json" // यहाँ Spelling फिक्स गरियो
            }
        });

        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data && output.data.length > 0) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            rasifalCache.source = "Google Gemini 1.5 Flash";
            console.log("✅ सफल: जेमिनाईले उच्च गुणस्तरको राशिफल तयार गर्यो।");
            return true;
        }
    } catch (e) {
        // लगमा एररको विस्तृत विवरण
        console.warn("⚠️ Gemini Error Details:", e.response ? JSON.stringify(e.response.data) : e.message);
        console.warn("🔄 अब Groq (Llama) बाट काम चलाउँदै...");

        // ६. Fallback to Groq Llama
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            rasifalCache.source = "Groq Llama (Fallback Mode)";
            console.log("✅ सफल: लामाले ब्याकअप डेटा तयार गर्यो।");
            return true;
        } catch (err) {
            console.error("❌ दुवै एआई इन्जिन फेल भए।");
            return false;
        }
    }
}

cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await updateRasifal();
    }
    res.json({
        status: "SUCCESS",
        updatedAt: rasifalCache.date,
        engine: rasifalCache.source,
        data: rasifalCache.data
    });
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR", engine: rasifalCache.source });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो।`);
    updateRasifal(); 
});
