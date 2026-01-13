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

let rasifalCache = { date: null, data: null };

async function getRawData() {
    let combinedContent = "";
    try {
        const [res1, res2] = await Promise.allSettled([
            axios.get('https://www.hamropatro.com/rashifal', { timeout: 8000 }),
            axios.get('https://www.nepalipatro.com.np/rashifal', { timeout: 8000 })
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
    const rawData = await getRawData();
    if (!rawData || rawData.length < 100) return false;

    // "No Word Match" नियम सहितको कडा प्रम्प्ट
    const prompt = `
    तपाईंको काम तल दिइएको राशिफलको डेटालाई आधार मानेर पूर्ण रूपमा मौलिक (Original) राशिफल लेख्नु हो।

    कडा निर्देशन (STRICT ZERO-MATCH POLICY):
    १. तपाईंको आउटपुटको कुनै पनि वाक्यका शब्दहरू 'Hamro Patro' वा 'Nepali Patro' को शब्दहरूसँग मेल खानु हुँदैन।
    २. लगातार ३ वटा शब्द पनि स्रोतसँग मिल्न पाइने छैन। (उदा: 'आर्थिक लेनदेनमा सतर्कता' को सट्टा 'पैसाको मामिलामा अलि सचेत' लेख्नुहोस्)
    ३. शब्दहरू मात्र होइन, वाक्यको बनोट (Sentence Structure) पनि पूर्ण रूपमा फेर्नुहोस्।
    ४. सबै १२ राशिका लागि फरक-फरक र ताजा शब्दहरू प्रयोग गर्नुहोस्।
    ५. यदि तपाईंले स्रोतका शब्दहरू दोहोर्याउनुभयो भने तपाईंको उत्तर अमान्य हुनेछ।

    RAW SOURCE DATA (ONLY FOR MEANING):
    ${rawData}

    Output format: JSON only.
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 1.0 // यसलाई १० बनाएर सिर्जनशीलता उच्च राखिएको छ
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        rasifalCache.data = aiOutput.data;
        rasifalCache.date = new Date().toISOString().split('T')[0];
        return true;
    } catch (e) {
        return false;
    }
}

cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data) await updateRasifal();
    res.json({ status: "SUCCESS", updatedAt: rasifalCache.date, data: rasifalCache.data });
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR" });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
