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
    
    const prompt = `तपाईं एक विद्धान र सिद्धहस्त नेपाली ज्योतिषी हुनुहुन्छ। 
आजको १२ राशिको राशिफल पूर्ण रूपमा फरक-फरक र शुद्ध नेपालीमा लेख्नुहोस्।

कडा नियमहरू:
१. विविधता: कुनै पनि दुई राशिको राशिफल मिल्दोजुल्दो हुनु हुँदैन। हरेक राशिका लागि नयाँ र मौलिक वाक्यहरू बुन्नुहोस्।
२. हिज्जे शुद्धता: "नयाँ" लाई "नयाँ" नै लेख्नुहोस् (नया होइन)। "बढ्नेछ", "मिल्नेछ" जस्ता भविष्यकालका शब्द प्रयोग गर्नुहोस्।
३. वाक्य संरचना: "आजको दिनैँ" को सट्टा "आज", "यस राशिका व्यक्तिलाई", वा "आजको समय" जस्ता फरक-फरक सुरुवात गर्नुहोस्।
४. शुभ रङ्ग र अङ्क: हरेक राशिको लागि अनिवार्य रूपमा एउटा रङ्ग र १-९ बीचको एउटा अङ्क दिनुहोस्।
५. लम्बाई: हरेक राशिको फल कम्तीमा ३ वटा वाक्यको हुनुपर्छ।

JSON Format: { "data": [ {"sign": "...", "prediction": "...", "shubh_rang": "...", "shubh_ank": "..."} ] }`;


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
