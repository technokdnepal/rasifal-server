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
    
    const prompt = `तपाईं एक विद्धान नेपाली ज्योतिषी हुनुहुन्छ। 
आजको राशिफल शुद्ध नेपाली र मौलिक शैलीमा लेख्नुहोस्।

नियमहरू:
१. हरेक राशिको लागि कम्तीमा ३ वटा फरक-फरक वाक्य लेख्नुहोस्।
२. एउटै वाक्य दुईवटा राशिमा दोहोर्याउन कडा प्रतिबन्ध छ।
३. 'शुभ अङ्क' मा १ देखि ९ सम्मको एउटा नम्बर मात्र दिनुहोस्।
४. राशिको नाम शुद्ध लेख्नुहोस् (उदा: मेष, वृष, मिथुन, कर्कट, सिंह, कन्या, तुला, वृश्चिक, धनु, मकर, कुम्भ, मीन)।
५. नेपाली व्याकरणमा कुनै पनि गल्ती हुनु हुँदैन।

उदाहरण शैली:
मेष: "आज रोकिएका कामहरू पुरा हुनेछन्। नयाँ लगानीको अवसर मिल्ने देखिन्छ। परिवारमा खुसीयाली छाउनेछ।"

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
