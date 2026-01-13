const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

// १. टाइमजोन सेटिङ
process.env.TZ = 'Asia/Kathmandu';
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// २. Environment Variables लोड गर्ने
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "डेटा लोड हुँदैछ..." 
};

// ३. हाम्रो पात्रोबाट डेटा तान्ने (Scraper)
async function getRawData() {
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item').each((i, el) => {
            const title = $(el).find('.title').text().trim();
            const desc = $(el).find('.desc').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });
        return content;
    } catch (e) {
        console.error("Scraping error:", e.message);
        return null;
    }
}

// ४. मुख्य एआई इन्जिन (English Generation)
async function updateRasifal() {
    console.log("⏳ अङ्ग्रेजीमा उच्च गुणस्तरको राशिफल तयार हुँदैछ...");
    const rawData = await getRawData();
    if (!rawData) return false;

    // अङ्ग्रेजीमा १००% शुद्ध र ६ वाक्यको नतिजाका लागि प्रम्प्ट
    const prompt = `You are a professional astrologer for technokd.com. 
    Your job is to read the Nepali data and convert it into high-quality, professional English.
    
    STRICT RULES:
    1. Write exactly 6 sentences for each zodiac sign.
    2. The meaning must be 100% accurate based on the source.
    3. Use professional and empathetic English tone.
    4. Return ONLY a valid JSON object.
    
    FORMAT: { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    DATA: ${rawData}`;

    // ५. Gemini प्रयास (v1beta with responseMimeType Fix)
    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { 
                responseMimeType: "application/json" 
            }
        });

        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data && output.data.length === 12) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = "Google Gemini (Professional English)";
            console.log("✅ सफल: जेमिनाईले अङ्ग्रेजी डेटा तयार गर्यो।");
            return true;
        }
    } catch (e) {
        console.warn("⚠️ Gemini Error:", e.response ? JSON.stringify(e.response.data) : e.message);
        
        // ६. Groq Llama Fallback (अङ्ग्रेजीका लागि यो निकै उत्कृष्ट छ)
        try {
            console.log("🔄 Groq (Llama) बाट अङ्ग्रेजीमा डेटा लिँदै...");
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = "Groq Llama (English Mode)";
            return true;
        } catch (err) {
            console.error("❌ दुवै एआई फेल भए।");
            return false;
        }
    }
}

// ७. सेड्युलर (राति १२:१०)
cron.schedule('10 0 * * *', updateRasifal);

// ८. एण्डपोइन्ट्स
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
    console.log(`🚀 Server started on port ${PORT}`);
    updateRasifal(); 
});
