const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant';

let rasifalCache = { date: null, data: [], source: "AI Detailed Explanation (Eng-to-Nep)" };

// राशिको नाम कन्फ्युजन नहोस् भनेर म्यापिङ
const zodiacMap = "Aries: मेष, Taurus: वृष, Gemini: मिथुन, Cancer: कर्कट, Leo: सिंह, Virgo: कन्या, Libra: तुला, Scorpio: वृश्चिक, Sagittarius: धनु, Capricorn: मकर, Aquarius: कुम्भ, Pisces: मीन";

async function getRawData() {
    let content = "";
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 10000 });
        const $ = cheerio.load(res.data);
        $('.item').each((i, el) => {
            content += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n";
        });
    } catch (e) { console.error("Scraping Error:", e.message); }
    return content;
}

async function updateRasifal() {
    console.log("⏳ अङ्ग्रेजीमा व्याख्या र नेपाली अनुवाद सुरु हुँदैछ...");
    const rawData = await getRawData();
    if (!rawData || rawData.length < 100) return false;

    const prompt = `
    You are an expert Astrologer and Language Specialist.
    
    TASK:
    1. Read the raw Nepali horoscope data provided below.
    2. Understand the meaning in English.
    3. Write a 5 to 6 sentence detailed explanation for each zodiac sign in ENGLISH. This expansion is mandatory to make the content unique.
    4. Translate these 5-6 original English sentences into high-quality, traditional Nepali (ट्रेडिसनल नेपाली).
    
    RULES:
    - Strictly use 5-6 sentences per sign.
    - Zodiac Mapping: ${zodiacMap}.
    - No Romanized Nepali. Use pure Nepali script.
    - Focus on grammar and professional tone.
    
    OUTPUT FORMAT:
    { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }

    RAW DATA:
    ${rawData}
    `;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.7
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        if (aiOutput.data && aiOutput.data.length > 0) {
            rasifalCache.data = aiOutput.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            return true;
        }
    } catch (e) { return false; }
}

cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) await updateRasifal();
    res.json({ status: "SUCCESS", updatedAt: rasifalCache.date, data: rasifalCache.data });
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR" });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
