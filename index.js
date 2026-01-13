const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

// १. टाइमजोन सेटिङ
process.env.TZ = process.env.TZ || 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

// २. Environment Variables लोड गर्ने
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "Google Gemini (High Quality Nepali)" 
};

// ३. स्क्र्यापर (Scraper)
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

    // कडा र स्पष्ट नेपाली प्रम्प्ट
    const prompt = `तपाईँ एक अनुभवी नेपाली ज्योतिषी र लेखक हुनुहुन्छ। 
    तलको डेटालाई आधार मानेर १२ वटै राशिको फल ५-६ वाक्यमा 'अत्यन्तै मिठो र प्राकृतिक' नेपालीमा लेख्नुहोस्।
    
    नियमहरू:
    १. भाषा 'मेशिन' जस्तो होइन, मान्छेले लेखेको जस्तो सुनिने हुनुपर्छ।
    २. 'दरवाजा', 'अच्छी', 'लग्नेछ' जस्ता हिन्दी शब्दहरू झुक्किएर पनि प्रयोग नगर्नुहोस्।
    ३. हरेक राशिको सुरु र अन्त्य गर्ने शैली फरक-फरक बनाउनुहोस्।
    ४. अनिवार्य रूपमा JSON ढाँचामा जवाफ दिनुहोस्।

    JSON: { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }
    डेटा: ${rawData}`;

    // पहिले Gemini 1.5 Flash प्रयास गर्ने
    try {
        console.log(`🚀 ${GEMINI_MODEL} बाट डेटा तान्दै...`);
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
        const response = await axios.post(geminiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
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
        console.warn("⚠️ Gemini मा समस्या आयो, अब Groq (Llama) बाट काम चलाउँदै...");
        // Fallback to Groq Llama
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });

            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            rasifalCache.source = "Groq Llama (Fallback)";
            console.log("✅ सफल: लामा (Llama) ले ब्याकअप डेटा तयार गर्यो।");
            return true;
        } catch (err) {
            console.error("❌ दुवै एआई इन्जिन फेल भए।");
            return false;
        }
    }
}

// ५. सेड्युलर (राति १२:१०)
cron.schedule('10 0 * * *', updateRasifal);

// ६. एण्डपोइन्ट्स
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
    res.json({ status: success ? "SUCCESS" : "ERROR" });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो।`);
    updateRasifal(); // सुरुमै एकपटक रन गर्ने
});
