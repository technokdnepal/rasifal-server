const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant'; // तपाईँले रोज्नुभएको स्थिर मोडल

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "Hamro Patro + Nepali Patro (AI Unique Mode)" 
};

// राशिको नाम म्यापिङ (कन्फ्युजन हटाउन)
const zodiacMapping = "Aries: मेष, Taurus: वृष, Gemini: मिथुन, Cancer: कर्कट, Leo: सिंह, Virgo: कन्या, Libra: तुला, Scorpio: वृश्चिक, Sagittarius: धनु, Capricorn: मकर, Aquarius: कुम्भ, Pisces: मीन";

async function getRawData() {
    let combinedContent = "";
    try {
        const [res1, res2] = await Promise.allSettled([
            axios.get('https://www.hamropatro.com/rashifal', { timeout: 10000 }),
            axios.get('https://www.nepalipatro.com.np/rashifal', { timeout: 10000 })
        ]);
        if (res1.status === 'fulfilled') {
            const $ = cheerio.load(res1.value.data);
            $('.item').each((i, el) => { combinedContent += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n"; });
        }
        if (res2.status === 'fulfilled') {
            const $ = cheerio.load(res2.value.data);
            $('.rashifal-item').each((i, el) => { combinedContent += $(el).find('h3').text() + ": " + $(el).find('p').text() + "\n"; });
        }
    } catch (e) { console.error("Scraping Error:", e.message); }
    return combinedContent;
}

async function updateRasifal() {
    console.log("⏳ अङ्ग्रेजी ड्राफ्ट र नेपाली अनुवाद प्रक्रिया सुरु भयो...");
    const rawData = await getRawData();
    if (!rawData || rawData.length < 100) return false;

    // तपाईँको नयाँ आइडिया अनुसारको प्रम्प्ट
    const prompt = `
    You are a Professional Astrologer and Translator.
    
    STEP 1: Analyze the raw Nepali horoscope data provided below.
    STEP 2: Write a unique, creative, and professional version of all 12 horoscopes in ENGLISH first (this prevents copying).
    STEP 3: Translate that English version into high-quality, Traditional Nepali (ट्रेडिसनल नेपाली).
    
    STRICT RULES:
    1. Do NOT use Romanized Nepali (e.g., 'Aaja ko din' is bad). Use 'आजको दिन' (Traditional).
    2. Use this mapping for Zodiac Signs: ${zodiacMapping}.
    3. Ensure 100% correct grammar and spelling.
    4. Each horoscope must be original and not a word-for-word copy of the source.
    
    JSON OUTPUT FORMAT:
    { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }

    SOURCE DATA:
    ${rawData}
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
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
            console.log("✅ अङ्ग्रेजी-टू-नेपाली राशिफल सफलतापूर्वक तयार भयो।");
            return true;
        }
    } catch (e) { 
        console.error("AI Update Error:", e.message);
        return false; 
    }
}

cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) await updateRasifal();
    res.json({
        status: "SUCCESS",
        updatedAt: rasifalCache.date,
        source: rasifalCache.source,
        data: rasifalCache.data
    });
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR", message: success ? "Updated" : "Failed" });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
