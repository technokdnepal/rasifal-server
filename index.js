const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// यी दुवै Key हरू Render को Environment Variables मा हुनुपर्छ
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const GROQ_API_KEY = process.env.GROQ_API_KEY;

let rasifalCache = { date: null, data: [] };

async function getRawData() {
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 10000 });
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item').each((i, el) => { content += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n"; });
        return content;
    } catch (e) { return null; }
}

async function updateRasifal() {
    const rawData = await getRawData();
    if (!rawData) return false;

    // जेमिनाईलाई दिइने कडा निर्देशन
    const promptText = `तपाईँ एक अनुभवी ज्योतिषी हुनुहुन्छ। यो डेटालाई आधार मानेर १२ वटै राशिको फल ५-६ वाक्यमा मिठो नेपालीमा लेख्नुहोस्। 
    नियम: 'दरवाजा' वा 'अच्छी' जस्ता हिन्दी शब्द नलगाउनुहोस्। 
    JSON ढाँचा: { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }
    डेटा: ${rawData}`;

    // पहिले जेमिनाई (Gemini 1.5 Flash) प्रयास गर्ने
    try {
        console.log("⏳ Gemini 1.5 Flash बाट प्रयास गर्दै...");
        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { response_mime_type: "application/json" }
            }
        );
        const output = JSON.parse(response.data.candidates[0].content.parts[0].text);
        if (output.data) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            return true;
        }
    } catch (e) {
        // यदि जेमिनाई फेल भयो भने Groq (Llama) चलाउने
        console.log("⚠️ Gemini मा समस्या आयो, Groq (Llama) बाट काम चलाउँदै...");
        try {
            const groqRes = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: promptText }],
                response_format: { type: "json_object" }
            }, { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } });
            
            const outputJSON = JSON.parse(groqRes.data.choices[0].message.content);
            rasifalCache.data = outputJSON.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            return true;
        } catch (err) { return false; }
    }
}

app.get('/api/rasifal', async (req, res) => {
    if (rasifalCache.data.length === 0) await updateRasifal();
    res.json({ status: "SUCCESS", updatedAt: rasifalCache.date, data: rasifalCache.data });
});

app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT}`);
    updateRasifal();
});
