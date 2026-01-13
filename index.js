const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

// नेपालको समय सेटिङ
process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

// Env Variables
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// इन-मेमोरी क्यास (Memory Cache)
let rasifalCache = {
    date: null,
    data: null,
    source: "Hamro Patro + Nepali Patro"
};

/* ==========================================
   १. स्क्र्यापर (Scrapers): वेबसाइटबाट डाटा तान्ने
   ========================================== */
async function getRawDataFromWebsites() {
    let combinedContent = "";
    try {
        // हाम्रो पात्रो र नेपाली पात्रो दुवैबाट डेटा तान्ने
        const [res1, res2] = await Promise.allSettled([
            axios.get('https://www.hamropatro.com/rashifal', { timeout: 8000 }),
            axios.get('https://www.nepalipatro.com.np/rashifal', { timeout: 8000 })
        ]);

        if (res1.status === 'fulfilled') {
            const $ = cheerio.load(res1.value.data);
            $('.item').each((i, el) => {
                combinedContent += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n";
            });
        }

        if (res2.status === 'fulfilled') {
            const $ = cheerio.load(res2.value.data);
            $('.rashifal-item').each((i, el) => {
                combinedContent += $(el).find('h3').text() + ": " + $(el).find('p').text() + "\n";
            });
        }
    } catch (e) {
        console.error("Scraping Error:", e.message);
    }
    return combinedContent;
}

/* ==========================================
   २. एआई (Groq AI): डाटा सफा गर्ने र मिलाउने
   ========================================== */
async function updateDailyRasifal() {
    console.log("⏳ डेटा अपडेट गर्ने प्रक्रिया सुरु भयो...");
    const rawData = await getRawDataFromWebsites();

    if (!rawData || rawData.length < 100) {
        console.error("❌ वेबसाइटबाट डेटा तान्न सकिएन।");
        return false;
    }

    const prompt = `
    You are a professional editor. Below is raw horoscope data from Hamro Patro and Nepali Patro.
    Combine them and rewrite into simple, clean, and natural Nepali. 
    Use ONLY the information provided. Do not use external knowledge.
    Output MUST be in valid JSON format.

    JSON FORMAT:
    { "data": [ {"sign": "मेष", "prediction": "..."}, {"sign": "वृष", "prediction": "..."} ] }

    RAW DATA:
    ${rawData}
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.2
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        
        // क्यासमा डाटा सेभ गर्ने
        rasifalCache.data = aiOutput.data;
        rasifalCache.date = new Date().toISOString().split('T')[0];
        
        console.log("✅ राशिफल सफलतापूर्वक अपडेट भयो।");
        return true;
    } catch (e) {
        console.error("❌ Groq AI Error:", e.message);
        return false;
    }
}

/* ==========================================
   ३. सेड्युलर (Scheduler): राति १२:१० मा चल्ने
   ========================================== */
cron.schedule('10 0 * * *', async () => {
    await updateDailyRasifal();
}, { timezone: "Asia/Kathmandu" });

/* ==========================================
   ४. एण्डपोइन्ट्स (Endpoints)
   ========================================== */

// मुख्य एपीआई (Main API)
app.get('/api/rasifal', async (req, res) => {
    // यदि सुरुमा डेटा छैन भने एकपटक अपडेट गर्ने प्रयास गर्ने
    if (!rasifalCache.data) {
        await updateDailyRasifal();
    }

    if (!rasifalCache.data) {
        return res.status(503).json({ status: "ERROR", message: "राशिफल अपडेट गर्न सकिएन" });
    }

    res.json({
        status: "SUCCESS",
        updatedAt: rasifalCache.date,
        source: rasifalCache.source,
        data: rasifalCache.data
    });
});

// जबरजस्ती अपडेट गर्ने (Force Update)
app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateDailyRasifal();
    if (success) {
        res.json({ status: "SUCCESS", message: "Data Updated" });
    } else {
        res.status(500).json({ status: "ERROR", message: "Update Failed" });
    }
});

app.get('/', (req, res) => res.send('✅ Rasifal Server is Running Perfectly!'));

app.listen(PORT, () => console.log(`🚀 Server started on port ${PORT}`));
