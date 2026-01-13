const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: new Date().toISOString().split('T')[0], 
    source: "Hybrid AI Unique Mode",
    data: [] 
};

// १. स्क्र्यापर (Scrapers)
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
    } catch (e) { console.error("Scrape Error:", e.message); }
    return combinedContent;
}

// २. एआई (Groq AI) - Zero Copy Logic
async function updateRasifal() {
    const rawData = await getRawData();
    if (!rawData || rawData.length < 100) return false;

    const prompt = `तपाईं एक लेखक हुनुहुन्छ। तलको डेटाबाट अर्थ लिनुहोस् तर शब्द एउटा पनि कोपी नगर्नुहोस्। 
    'आर्थिक लेनदेनमा सतर्कता' जस्ता वाक्यांशको सट्टा 'पैसाको मामिलामा सावधानी' जस्ता नयाँ शब्द प्रयोग गर्नुहोस्। 
    वाक्यको बनोट पूर्ण फेर्नुहोस्। JSON ढाँचा: { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }
    डेटा: ${rawData}`;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions',
            { model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], response_format: { type: "json_object" }, temperature: 0.9 },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        if (aiOutput.data) {
            rasifalCache.data = aiOutput.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            return true;
        }
    } catch (e) { return false; }
}

// ३. एण्डपोइन्ट फिक्स (अब डेटा हराउँदैन)
app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) await updateRasifal();
    res.json(rasifalCache); // सबै फिल्डहरू (status, date, data) यहाँबाट जान्छन्
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const s = await updateRasifal();
    res.json({ status: s ? "SUCCESS" : "ERROR" });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));

