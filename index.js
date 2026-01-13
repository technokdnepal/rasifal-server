const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

let rasifalCache = { date: null, data: [] };

// १. स्क्र्यापर (Scraper)
async function getRawData() {
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 10000 });
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item').each((i, el) => { content += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n"; });
        return content;
    } catch (e) { return null; }
}

// २. मुख्य फङ्सन (Gemini पहिलो प्राथमिकता, Llama दोस्रो)
async function updateRasifal() {
    const rawData = await getRawData();
    if (!rawData) return false;

    const promptText = `Write a professional 6-sentence Nepali horoscope for 12 signs based on this data: ${rawData}. Use natural tone, no Hindi words. Output JSON: { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }`;

    // पहिले जेमिनाई प्रयास गर्ने
    try {
        console.log("⏳ Gemini बाट डेटा लिने प्रयास...");
        const geminiRes = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { response_mime_type: "application/json" }
        });
        const output = JSON.parse(geminiRes.data.candidates[0].content.parts[0].text);
        if (output.data) {
            rasifalCache.data = output.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            return true;
        }
    } catch (e) {
        console.log("⚠️ Gemini मा इरोर आयो, अब Groq (Llama) बाट डेटा लिँदैछु...");
        // यदि जेमिनाई फेल भयो भने Groq (Llama) चलाउने
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
    res.json({ status: "SUCCESS", data: rasifalCache.data });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर सुरु भयो।`);
    updateRasifal();
});
