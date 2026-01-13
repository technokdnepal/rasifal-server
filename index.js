const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

// नेपालको समय क्षेत्र सेटिङ
process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
// नेपाली भाषाको शुद्धताका लागि ७०बी मोडल सिफारिस गरिन्छ, नभए ८बी चल्छ
const GROQ_MODEL = "llama-3.1-70b-versatile"; 

let rasifalCache = { 
    date: null, 
    source: "Pure AI Original Generation",
    data: [] 
};

/* ==========================================
   १. एआई (Groq AI) - मौलिक राशिफल सिर्जना
   ========================================== */
async function generateUniqueRasifal() {
    console.log("⏳ एआईबाट मौलिक र शुद्ध नेपाली राशिफल तयार पारिँदैछ...");

    const prompt = `
    तपाईं एक विद्धान र अनुभवी नेपाली ज्योतिषी हुनुहुन्छ। 
    आजको मितिको लागि १२ राशिको फल एकदमै शुद्ध, मौलिक र व्याकरण मिलेको नेपाली भाषामा लेख्नुहोस्।

    नियमहरू (STRICT RULES):
    १. कुनै पनि वेबसाइटको डेटा प्रयोग नगर्नुहोस्। आफ्नै ज्योतिषीय ज्ञानबाट लेख्नुहोस्।
    २. भाषा एकदमै मिठो, शिष्ट र शुद्ध नेपाली हुनुपर्छ। (उदा: 'बढ्नेछ' लेख्नुहोस्, 'वढेरै' जस्ता गल्ती नगर्नुहोस्)।
    ३. हरेक राशिको लागि २-३ वाक्यको फल, १ शुभ रङ्ग र १ शुभ अङ्क समावेश गर्नुहोस्।
    ४. "आजको दिनमा" बाट हरेक वाक्य सुरु नगर्नुहोस्। वाक्यको बनोट फरक-फरक राख्नुहोस्।
    ५. आउटपुट अनिवार्य रूपमा यो JSON ढाँचामा हुनुपर्छ:
    { "data": [ {"sign": "मेष", "prediction": "...", "shubh_rang": "...", "shubh_ank": "..."}, ... ] }
    `;

    try {
        const response = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.8 // सिर्जनशीलताको लागि
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        
        if (aiOutput.data && aiOutput.data.length > 0) {
            rasifalCache.data = aiOutput.data;
            rasifalCache.date = new Date().toLocaleDateString('ne-NP'); // नेपाली मिति
            console.log("✅ मौलिक राशिफल सफलतापूर्वक तयार भयो।");
            return true;
        }
        return false;
    } catch (e) {
        console.error("❌ एआई जेनेरेसन फेल:", e.message);
        return false;
    }
}

/* ==========================================
   २. सेड्युलर र एण्डपोइन्ट्स
   ========================================== */

// राति १२:१० मा नयाँ राशिफल बनाउने
cron.schedule('10 0 * * *', generateUniqueRasifal);

app.get('/api/rasifal', async (req, res) => {
    // यदि मेमोरीमा डाटा छैन भने तत्काल बनाउने
    if (!rasifalCache.data || rasifalCache.data.length === 0) {
        await generateUniqueRasifal();
    }
    res.json({
        status: "SUCCESS",
        updatedAt: rasifalCache.date,
        source: rasifalCache.source,
        data: rasifalCache.data
    });
});

// म्यानुअल अपडेटका लागि
app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await generateUniqueRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR", message: success ? "Data Generated" : "Failed" });
});

app.get('/', (req, res) => res.send('🚀 Pure AI Rasifal Server is Online!'));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
