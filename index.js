const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000; // Render को डिDefault पोर्ट १०००० हुन्छ

// १. सेटअप: एआई मोडलको नाममा '-latest' हटाएर सिधै 'gemini-1.5-flash' राख्ने
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// २. क्यास (Cache) को लागि डाटा
let rasifalCache = {
    date: "",
    data: null
};

app.get('/api/rasifal', async (req, res) => {
    try {
        const today = new Date().toISOString().split("T")[0];

        // क्यास चेक
        if (rasifalCache.date === today && rasifalCache.data) {
            console.log("⚡ Serving from Cache...");
            return res.json({
                status: "SUCCESS",
                updatedAt: rasifalCache.date,
                source: "AI_CACHE",
                data: rasifalCache.data
            });
        }

        console.log("🤖 एआईले १२ राशिको नयाँ राशिफल लेख्दैछ...");
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

        // ३. प्रम्प्ट: सरल भाषा र १२ वटा राशिको ग्यारेन्टी
        const prompt = `तपाईं एक अनुभवी नेपाली ज्योतिषी हुनुहुन्छ। 
        आजको मिति ${today} को लागि मेष देखि मीन सम्मका १२ वटै राशिको दैनिक राशिफल लेख्नुहोस्।
        - भाषा एकदम सरल र सकारात्मक नेपाली हुनुपर्छ।
        - राशिको नाम बाहेक कुनै पनि ब्र्याकेट वा अक्षरहरू (जस्तै: चु, चे) नलेख्नुहोस्।
        - जवाफ केवल JSON Array मा मात्र दिनुहोस्: [{"sign": "मेष", "prediction": "..."}, ...] 
        - अनिवार्य रूपमा १२ वटै राशि समावेश हुनुपर्छ।`;

        // ४. टाइमआउट: १० सेकेन्डभन्दा बढी कुर्न नदिने
        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error("AI_TIMEOUT")), 10000))
        ]);

        const responseText = result.response.text().replace(/```json|```/g, '').trim();
        const finalData = JSON.parse(responseText);

        // क्यासमा सेभ गर्ने
        rasifalCache = { date: today, data: finalData };

        res.json({
            status: "SUCCESS",
            updatedAt: today,
            source: "GEMINI_AI",
            data: finalData
        });

    } catch (e) {
        console.error("⚠️ Error Occurred:", e.message);

        // एआई फेल भयो भने पुरानो डाटा पठाउने
        if (rasifalCache.data) {
            return res.json({
                status: "OFFLINE_SUCCESS",
                updatedAt: rasifalCache.date,
                source: "LAST_KNOWN_DATA",
                data: rasifalCache.data
            });
        }

        res.status(500).json({ status: "ERROR", message: "डेटा प्राप्त गर्न सकिएन।" });
    }
});

app.get('/', (req, res) => res.send('AI Rasifal Server is Online! 🚀'));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
