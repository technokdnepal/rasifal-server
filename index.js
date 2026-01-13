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

// १. क्यास सेटअप (सिधै खाली नराख्ने)
let rasifalCache = { 
    date: new Date().toISOString().split('T')[0], 
    source: "Hamro Patro + Nepali Patro (AI Rewritten)",
    data: [] 
};

/* ==========================================
   २. स्क्र्यापर (Scrapers)
   ========================================== */
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

/* ==========================================
   ३. एआई (Groq AI) - कडा नियम सहित
   ========================================== */
async function updateRasifal() {
    console.log("⏳ नयाँ डेटा प्रोसेस हुँदैछ...");
    const rawData = await getRawData();
    if (!rawData || rawData.length < 100) return false;

const prompt = `
    तपाईं एक सिद्धहस्त नेपाली लेखक हुनुहुन्छ। तलको राशिफलको आधारमा पूर्ण रूपमा मौलिक र शुद्ध नेपालीमा राशिफल लेख्नुहोस्।

    अनिवार्य सर्तहरू:
    १. 'Zero-Match Policy': कुनै पनि वाक्य स्रोतसँग मेल खानु हुँदैन।
    २. 'No Pattern': हरेक राशिको सुरुवात फरक तरिकाले गर्नुहोस्। (उदा: कुनैमा "यस राशिका व्यक्तिलाई...", कुनैमा "आज तपाईँको...", कुनैमा "समय अनुकूल छ...")
    ३. 'Spelling Check': नेपाली व्याकरण र हिज्जे (Spelling) १००% शुद्ध हुनुपर्छ। "पुर्याउनुहोलाई" वा "रहनुहोसै" जस्ता अशुद्ध शब्द लेख्न पाइने छैन।
    ४. 'Natural Style': मान्छेले लेखेको जस्तो प्राकृतिक र मिठो भाषा प्रयोग गर्नुहोस्।

    DATA: ${rawData}
    `;
    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.9 
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        // डेटा सुनिश्चित गर्ने
        if (aiOutput.data && Array.isArray(aiOutput.data)) {
            rasifalCache.data = aiOutput.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            console.log("✅ डेटा अपडेट भयो!");
            return true;
        }
        return false;
    } catch (e) {
        console.error("AI Update Failed:", e.message);
        return false;
    }
}

// ४. सेड्युलर (राति १२:१०)
cron.schedule('10 0 * * *', updateRasifal);

/* ==========================================
   ५. एपीआई एण्डपोइन्ट्स (Endpoints)
   ========================================== */
app.get('/api/rasifal', async (req, res) => {
    // यदि मेमोरीमा डाटा छैन भने एकपटक अपडेट गर्ने
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await updateRasifal();
    }
    
    // अब सबै फिल्डहरू अनिवार्य रूपमा पठाउने
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

app.get('/', (req, res) => res.send('🚀 Rasifal API Server is Online'));

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
