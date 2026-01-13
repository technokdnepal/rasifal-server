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

// २. कुञ्जीहरू लोड गर्ने
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "प्रतीक्षा गरिँदै..." 
};

// ३. हाम्रो पात्रोबाट डेटा तान्ने
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

// ४. मुख्य एआई कार्यविधि
async function updateRasifal() {
    console.log("⏳ नयाँ राशिफल तयार हुँदैछ...");
    const rawData = await getRawData();
    if (!rawData) return false;

    // एआईलाई कडा र स्पष्ट निर्देशन
    const prompt = `You are a professional astrologer for technokd.com.
    TASK: Write a 6-sentence detailed daily horoscope for each of the 12 zodiac signs based on the provided data.
    
    STRICT RULES:
    1. Write exactly 6 sentences for each sign.
    2. Use pure, natural Nepali language only. No nonsense words like 'किर्ण' or 'छालो'.
    3. Do NOT repeat the signs or append extra text after the JSON.
    4. Provide the result ONLY in this JSON format: { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }
    
    SOURCE DATA:
    ${rawData}`;

    // ५. पहिले Gemini प्रयास (v1 Endpoint)
    try {
        console.log(`🚀 Gemini (${GEMINI_MODEL}) बाट प्रयास गर्दै...`);
        // यहाँ हामीले v1beta को सट्टा v1 प्रयोग गरेका छौँ र responseMimeType लाई CamelCase मा राखेका छौँ
        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        
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
            rasifalCache.source = "Google Gemini 1.5 Flash";
            console.log("✅ सफल: जेमिनाईले उत्कृष्ट डेटा तयार गर्यो।");
            return true;
        }
    } catch (e) {
        // जेमिनाई फेल हुँदाको वास्तविक एरर हेर्न यो लग अति आवश्यक छ
        console.error("❌ Gemini Error Details:", e.response ? JSON.stringify(e.response.data) : e.message);
        
        // ६. Fallback to Groq Llama
        console.log("🔄 अब Groq (Llama) बाट काम चलाउँदै...");
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = "Groq Llama (Fallback Mode)";
            console.log("✅ सफल: लामाले ब्याकअप डेटा तयार गर्यो।");
            return true;
        } catch (err) {
            console.error("❌ दुवै एआई इन्जिन फेल भए।");
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
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो।`);
    updateRasifal(); 
});
