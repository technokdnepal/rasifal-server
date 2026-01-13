const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

// नेपालको समय क्षेत्र सेटिङ
process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

// इन-मेमोरी क्यास
let rasifalCache = {
    date: null,
    data: null,
    source: "Hamro Patro + Nepali Patro (AI Rewritten)"
};

/* ==========================================
   १. स्क्र्यापर: दुईवटा वेबसाइटबाट काँचो डेटा तान्ने
   ========================================== */
async function getRawData() {
    let combinedContent = "";
    try {
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
   २. एआई: कोपी-पेस्ट रोक्ने कडा निर्देशन (Prompt)
   ========================================== */
async function updateRasifal() {
    console.log("⏳ नयाँ र मौलिक राशिफल तयार पारिँदैछ...");
    const rawData = await getRawData();

    if (!rawData || rawData.length < 100) return false;

    // एआईलाई झुक्किन नदिने कडा प्रम्प्ट
    const prompt = `
    तपाईं एक विद्धान नेपाली ज्योतिषी र दक्ष लेखक हुनुहुन्छ। 
    तल 'हाम्रो पात्रो' र 'नेपाली पात्रो' को राशिफलको काँचो डेटा छ।

    तपाईंको अनिवार्य काम (STRICT RULES):
    १. यसको अर्थ (Meaning) मात्र लिनुहोस्, तर वाक्य पूर्ण रूपमा नयाँ बनाउनुहोस्।
    २. "आजको दिनमा" वा "आज" जस्ता शब्दबाट हरेक राशि सुरु नगर्नुहोस्। वाक्यको शैली परिवर्तन गर्नुहोस्।
    ३. कोपी-पेस्ट कडा रूपमा निषेध छ। समानार्थी शब्दहरू प्रयोग गर्नुहोस्।
       (उदाहरण: 'आर्थिक लाभ' को सट्टा 'आम्दानीको स्रोत बढ्नेछ', 'सतर्क रहनुहोस्' को सट्टा 'विशेष सावधानी अपनाउनु बुद्धिमानी हुनेछ')
    ४. १२ वटै राशिको फल मौलिक र मिठो नेपालीमा लेख्नुहोस्।
    ५. आउटपुट अनिवार्य रूपमा JSON ढाँचामा हुनुपर्छ।

    JSON FORMAT:
    { "data": [ {"sign": "मेष", "prediction": "..."}, ... ] }

    RAW SOURCE DATA:
    ${rawData}
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.7 // सिर्जनशीलता बढाउन अलि धेरै राखिएको
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        rasifalCache.data = aiOutput.data;
        rasifalCache.date = new Date().toISOString().split('T')[0];
        console.log("✅ मौलिक राशिफल अपडेट भयो।");
        return true;
    } catch (e) {
        console.error("❌ एआई अपडेट फेल:", e.message);
        return false;
    }
}

/* ==========================================
   ३. सेड्युलर र एण्डपोइन्ट्स
   ========================================== */

// राति १२:१० मा स्वतः चल्ने
cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data) await updateRasifal();
    
    if (!rasifalCache.data) {
        return res.status(503).json({ status: "ERROR", message: "Data Not Available" });
    }

    res.json({
        status: "SUCCESS",
        updatedAt: rasifalCache.date,
        source: rasifalCache.source,
        data: rasifalCache.data
    });
});

// म्यानुअल अपडेटको लागि
app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR" });
});

app.get('/', (req, res) => res.send('✅ Standard Rasifal Server is Live!'));

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
