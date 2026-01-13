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
    source: "Waiting for update..." 
};

// ३. हाम्रो पात्रोबाट नेपाली डेटा तान्ने
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

// ४. अङ्ग्रेजीमा राशिफल तयार गर्ने मुख्य फङ्सन
async function updateRasifal() {
    console.log("⏳ अङ्ग्रेजीमा उच्च गुणस्तरको राशिफल तयार हुँदैछ...");
    const rawData = await getRawData();
    if (!rawData) return false;

    // एआईलाई अङ्ग्रेजीमा लेख्न दिइएको कडा निर्देशन
    const prompt = `You are a professional English Astrologer for 'technokd.com'.
    TASK: Translate the following Nepali horoscope data into detailed, high-quality English.
    
    STRICT RULES:
    1. Sentence Count: Write exactly 5 to 6 meaningful sentences for each zodiac sign.
    2. Tone: Professional, clear, and empathetic.
    3. Accuracy: Ensure the 100% correct meaning is preserved from the source.
    4. Format: Return the result strictly in this JSON format:
       { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    
    SOURCE NEPALI DATA:
    ${rawData}`;

    // ५. Gemini प्रयास (English output का लागि)
    try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data && output.data.length === 12) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = "Google Gemini (High Quality English)";
            console.log("✅ सफल: जेमिनाईले अङ्ग्रेजी राशिफल तयार गर्यो।");
            return true;
        }
    } catch (e) {
        // ६. Fallback to Groq Llama (अङ्ग्रेजीका लागि यो निकै भरपर्दो छ)
        console.warn("🔄 Gemini फेल भयो, अब Groq (Llama) बाट अङ्ग्रेजीमा डेटा निकाल्दै...");
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = "Groq Llama (English Back-up)";
            console.log("✅ सफल: लामाले अङ्ग्रेजीमा ब्याकअप डेटा तयार गर्यो।");
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

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो।`);
    updateRasifal(); 
});
