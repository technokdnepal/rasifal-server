const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// यदि ७०बी ले काम गरेन भने 'llama-3.1-8b-instant' मा फेर्नुहोस्
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-70b-versatile"; 

let rasifalCache = { 
    date: new Date().toISOString().split('T')[0], 
    source: "Pure AI Original Mode",
    data: [] 
};

async function generateUniqueRasifal() {
    console.log("🤖 एआईसँग नयाँ र मौलिक राशिफल मागिँदैछ...");
    
    const prompt = `तपाईं एक विद्धान नेपाली ज्योतिषी र दक्ष साहित्यकार हुनुहुन्छ। 
आजको १२ राशिको राशिफल पूर्ण रूपमा मौलिक, साहित्यिक र शुद्ध नेपालीमा लेख्नुहोस्।

कडा निर्देशनहरू:
१. "उत्साहित भए पाएन" वा "रहेला चाहिए" जस्ता अर्थहीन शब्दहरू प्रयोग गर्न कडा प्रतिबन्ध छ।
२. हिन्दी शब्दहरू (जस्तै: थोड़ा) प्रयोग नगर्नुहोस्। शुद्ध ठेट नेपाली शब्दहरू प्रयोग गर्नुहोस्।
३. हरेक राशिको सुरुवात फरक शैलीमा गर्नुहोस्। "आज यस राशिका व्यक्तिलाई..." भन्ने एउटै ढाँचा सबैमा नदोहोर्याउनुहोस्।
४. राशिको नाम शुद्ध लेख्नुहोस् (विशेष गरी 'कर्कट' र 'मकर')।
५. राशिफललाई अलि उत्साहजनक र सकारात्मक बनाउनुहोस्।

JSON ढाँचा: { "data": [ {"sign": "...", "prediction": "...", "shubh_rang": "...", "shubh_ank": "..."} ] }`;


    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.8
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 30000 }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        
        if (aiOutput.data && Array.isArray(aiOutput.data)) {
            rasifalCache.data = aiOutput.data;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            console.log("✅ डेटा सफलतापूर्वक अपडेट भयो!");
            return true;
        }
    } catch (e) {
        console.error("❌ AI Error Details:", e.response ? e.response.data : e.message);
    }
    return false;
}

cron.schedule('10 0 * * *', generateUniqueRasifal);

app.get('/api/rasifal', async (req, res) => {
    // यदि सुरुमा डेटा खाली छ भने अपडेट गर्ने प्रयास गर्ने
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await generateUniqueRasifal();
    }
    res.json(rasifalCache);
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await generateUniqueRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR", message: success ? "New data generated" : "Failed to generate" });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
