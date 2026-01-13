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

// २. कुञ्जीहरू (Keys) लोड गर्ने
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "Waiting for data update..." 
};

// ३. अत्यन्तै बलियो बहु-स्रोत स्क्र्यापर
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
        
        // धेरै प्रकारका सेलेक्टरहरू प्रयोग गरिएको ताकि संरचना बदलिए पनि काम गरोस्
        $('.item, .desc-card, .article-content').each((i, el) => {
            const title = $(el).find('.title, h2, h3').text().trim();
            const desc = $(el).find('.desc, p, .desc-card-text').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });

        if (content.length > 300) {
            return { source: "Hamro Patro", text: content };
        }
    } catch (e) {
        console.warn("⚠️ हाम्रो पात्रोमा समस्या आयो, ब्याकअपमा जाँदै...");
    }

    // प्रयास २: नेपाली पात्रो (Backup)
    try {
        console.log("🌐 नेपाली पात्रोबाट डेटा तान्दै...");
        const res = await axios.get('https://www.nepalipatro.com.np/rashifal', config);
        const $ = cheerio.load(res.data);
        let content = "";
        
        $('.horoscope-sign-info, .card, .rashifal-card').each((i, el) => {
            const title = $(el).find('h2, .title, h4').text().trim();
            const desc = $(el).find('p, .description, .text-justify').text().trim();
            if (title && desc) content += `${title}: ${desc}\n`;
        });

        if (content.length > 300) {
            return { source: "Nepali Patro", text: content };
        }
    } catch (e) {
        console.error("❌ दुवै स्रोतहरू असफल भए।");
        return null;
    }
}

// ४. मुख्य एआई इन्जिन (English Explanation Mode)
async function updateRasifal() {
    console.log("⏳ अङ्ग्रेजीमा राशिफलको व्याख्या तयार हुँदैछ...");
    const rawDataObj = await getRawData();
    
    if (!rawDataObj) {
        rasifalCache.source = "Scraping Failed on all sources";
        return false;
    }

    // एआईलाई अङ्ग्रेजीमा व्याख्या गर्न कडा निर्देशन
    const prompt = `You are a professional English Astrologer. 
    Using the following raw data from ${rawDataObj.source}, EXPLAIN each of the 12 zodiac signs in 5-6 detailed, professional English sentences.
    
    STRICT RULES:
    1. Sentence Count: Write exactly 5 to 6 meaningful sentences for each sign.
    2. Meaning: Preserve the 100% correct essence and meaning from the source.
    3. Output: Provide ONLY a valid JSON object.
    
    JSON FORMAT: { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    DATA: ${rawDataObj.text}`;

    // Gemini प्रयास (v1beta with responseMimeType Fix)
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
            rasifalCache.source = `Google Gemini (${rawDataObj.source})`;
            console.log("✅ सफल: जेमिनाईले अङ्ग्रेजी व्याख्या तयार गर्यो।");
            return true;
        }
    } catch (e) {
        // Fallback to Groq Llama
        console.warn("🔄 Gemini फेल भयो, अब Groq (Llama) बाट अङ्ग्रेजीमा व्याख्या गर्दै...");
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
            console.error("❌ दुवै एआई फेल भए।");
            return false;
        }
    }
}

// ५. सेड्युलर (राति १२:१०)
cron.schedule('10 0 * * *', updateRasifal);

// ६. एण्डपोइन्ट्स (Routes)
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
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो।`);
    updateRasifal(); 
});
