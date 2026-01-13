const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const cors = require('cors');
require('dotenv').config();

// १. सर्भर र टाइमजोन सेटिङ (२०२६ सालको सन्दर्भमा)
process.env.TZ = 'Asia/Kathmandu';
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// २. एआई कुञ्जीहरू (API Keys)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "Waiting for 4:00 AM update..." 
};

// ३. वेबसाइटबाट 'रेफरेन्स' टेक्स्ट लिने सरल तरिका
async function getWebsiteReference() {
    const config = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 20000
    };
    
    // प्रयास १: हाम्रो पात्रो (Reference 1)
    try {
        console.log("🌐 हाम्रो पात्रोबाट रेफरेन्स लिँदै...");
        const res = await axios.get('https://www.hamropatro.com/rashifal', config);
        const $ = cheerio.load(res.data);
        // कुनै जटिल कोड नखोज्ने, मात्र सबै टेक्स्ट लिने
        const fullText = $('body').text().replace(/\s+/g, ' ').trim(); 
        if (fullText.length > 500) return { source: "Hamro Patro", text: fullText.substring(0, 10000) };
    } catch (e) {
        console.warn("⚠️ हाम्रो पात्रो उपलब्ध भएन, दोस्रो रेफरेन्समा जाँदै...");
    }

    // प्रयास २: नेपाली पात्रो (Reference 2)
    try {
        console.log("🌐 नेपाली पात्रोबाट रेफरेन्स लिँदै...");
        const res = await axios.get('https://www.nepalipatro.com.np/rashifal', config);
        const $ = cheerio.load(res.data);
        const fullText = $('body').text().replace(/\s+/g, ' ').trim();
        if (fullText.length > 500) return { source: "Nepali Patro", text: fullText.substring(0, 10000) };
    } catch (e) {
        console.error("❌ दुवै रेफरेन्स वेबसाइटहरू उपलब्ध भएनन्।");
        return null;
    }
}

// ४. एआईले पढेर व्याख्या गर्ने मुख्य कार्यविधि
async function updateRasifal() {
    console.log("⏳ एआईले रेफरेन्स पढेर अङ्ग्रेजीमा व्याख्या गर्दैछ...");
    const reference = await getWebsiteReference();
    
    if (!reference) {
        rasifalCache.source = "Reference Website Access Error";
        return false;
    }

    const prompt = `You are a professional English Astrologer. 
    I will provide you with the raw text from the website ${reference.source}. 
    Your task is to identify the horoscopes for all 12 signs from this text and EXPLAIN each sign in 5-6 detailed, professional English sentences.
    
    STRICT RULES:
    1. Accuracy: The meaning must be 100% correct based on the website's reference.
    2. Length: Write exactly 5 to 6 sentences for each sign.
    3. Output: Provide ONLY a valid JSON object.
    
    JSON FORMAT: { "data": [ {"sign": "Aries", "prediction": "..."}, ... ] }
    REFERENCE TEXT: ${reference.text}`;

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
            rasifalCache.source = `Google Gemini (Ref: ${reference.source})`;
            console.log("✅ सफल: एआईले रेफरेन्स पढेर अङ्ग्रेजी व्याख्या तयार गर्यो।");
            return true;
        }
    } catch (e) {
        // Fallback to Groq Llama
        try {
            console.log("🔄 Groq (Llama) बाट व्याख्या गर्दै...");
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toLocaleDateString('en-CA');
            rasifalCache.source = `Groq Llama (Ref: ${reference.source})`;
            return true;
        } catch (err) {
            return false;
        }
    }
}

// ५. सेड्युलर (बिहान ठ्याक्कै ४:०० बजे स्वतः चल्ने)
cron.schedule('0 4 * * *', updateRasifal);

// ६. एण्डपोइन्ट्स
app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await updateRasifal();
    }
    res.json(rasifalCache);
});

// ७. फोर्स अपडेट (म्यानुअली चेक गर्नका लागि)
app.get('/api/rasifal/force-update', async (req, res) => {
    const result = await updateRasifal();
    res.json({ success: result, engine: rasifalCache.source });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो। अर्को अपडेट बिहान ४ बजे हुनेछ।`);
    updateRasifal(); 
});
