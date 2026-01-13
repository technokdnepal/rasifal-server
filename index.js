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

// इन-मेमोरी क्यास (सुरुमा खाली नराख्ने)
let rasifalCache = { 
    date: new Date().toISOString().split('T')[0], 
    data: null 
};

/* =======================
   १. स्क्र्यापर (Scrapers)
   ======================= */
async function getRawData() {
    let combinedContent = "";
    try {
        const [res1, res2] = await Promise.allSettled([
            axios.get('https://www.hamropatro.com/rashifal', { timeout: 10000 }),
            axios.get('https://www.nepalipatro.com.np/rashifal', { timeout: 10000 })
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
        console.error("Scraping error:", e.message);
    }
    return combinedContent;
}

/* =======================
   २. एआई (Groq AI Update)
   ======================= */
async function updateRasifal() {
    console.log("⏳ डेटा अपडेट गर्ने प्रयास भइरहेको छ...");
    const rawData = await getRawData();

    // यदि वेबसाइटबाट डेटा आएन भने रोक्ने
    if (!rawData || rawData.length < 100) {
        console.log("❌ वेबसाइटबाट डेटा तान्न सकिएन।");
        return false;
    }

    const prompt = `तपाईं एक विद्धान नेपाली लेखक हुनुहुन्छ। 
    तलको डेटालाई आधार मानेर पूर्ण रूपमा मौलिक (Original) नेपाली राशिफल लेख्नुहोस्। 
    नियम: १. स्रोतको वाक्य वा शब्दहरू कोपी नगर्नुहोस्। २. व्याकरण शुद्ध राख्नुहोस्। ३. उत्तर अनिवार्य रूपमा JSON मा हुनुपर्छ। 
    JSON: { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }
    डेटा: ${rawData}`;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.8
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        
        // डेटा छ कि छैन पक्का गर्ने
        if (aiOutput.data && aiOutput.data.length > 0) {
            rasifalCache.data = aiOutput.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            console.log("✅ सफल अपडेट!");
            return true;
        }
    } catch (e) {
        console.error("AI Error:", e.message);
    }
    return false;
}

// ३. सेड्युलर (राति १२:१०)
cron.schedule('10 0 * * *', updateRasifal);

/* =======================
   ४. एण्डपोइन्ट्स (Endpoints)
   ======================= */
app.get('/api/rasifal', async (req, res) => {
    // यदि क्यास खाली छ भने तत्काल अपडेट गर्ने
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await updateRasifal();
    }

    res.json({
        status: "SUCCESS",
        updatedAt: rasifalCache.date,
        source: "Hamro Patro + Nepali Patro (AI Unique Mode)",
        data: rasifalCache.data || []
    });
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR", message: success ? "Updated" : "Failed" });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
