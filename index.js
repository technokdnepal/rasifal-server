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

// १. क्यास सेटअप
let rasifalCache = { 
    date: null, 
    data: [], 
    source: "AI Detailed 6-Sentence Translation" 
};

// राशिको नाम म्यापिङ
const zodiacMap = "Aries: मेष, Taurus: वृष, Gemini: मिथुन, Cancer: कर्कट, Leo: सिंह, Virgo: कन्या, Libra: तुला, Scorpio: वृश्चिक, Sagittarius: धनु, Capricorn: मकर, Aquarius: कुम्भ, Pisces: मीन";

async function getRawData() {
    let content = "";
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
        const $ = cheerio.load(res.data);
        $('.item').each((i, el) => {
            content += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n";
        });
    } catch (e) { console.error("Scraping Error:", e.message); }
    return content;
}

async function updateRasifal() {
    console.log("⏳ नयाँ प्रक्रिया: अङ्ग्रेजीमा व्याख्या र नेपाली अनुवाद सुरु भयो...");
    const rawData = await getRawData();
    
    if (!rawData || rawData.length < 100) {
        console.log("❌ वेबसाइटबाट डेटा तान्न सकिएन।");
        return false;
    }

    // तपाईँको ५-६ वाक्यको आइडिया
    const prompt = `
    You are an expert Astrologer. 
    1. Read the Nepali horoscope data provided below.
    2. Write a detailed 5 to 6 sentence explanation for EACH zodiac sign in ENGLISH first. 
    3. Then, translate those 5-6 sentences into pure, traditional Nepali.
    
    Zodiac Mapping: ${zodiacMap}.
    Output must be a valid JSON object.
    Structure: { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }

    DATA:
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
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        
        if (aiOutput.data && Array.isArray(aiOutput.data) && aiOutput.data.length > 0) {
            rasifalCache.data = aiOutput.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            console.log("✅ १२ वटै राशिको ५-६ वाक्यको फल तयार भयो।");
            return true;
        } else {
            console.log("⚠️ एआईले खाली डेटा पठायो।");
            return false;
        }
    } catch (e) { 
        console.error("❌ एआई एरर:", e.response ? e.response.data : e.message);
        return false; 
    }
}

// राति १२:१० मा स्वतः चल्ने
cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    // यदि क्यास खाली छ भने तत्काल डेटा तान्ने
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        console.log("🔄 क्यास खाली छ, पहिलो पटक डेटा लोड हुँदैछ...");
        await updateRasifal();
    }
    
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

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा सुरु भयो।`);
    // सर्भर सुरु हुने बित्तिकै एकपटक डेटा तान्न सुरु गर्ने
    updateRasifal();
});
