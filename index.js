const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
// Render को लागि पोर्ट १०००० सेट गरिएको छ
const PORT = process.env.PORT || 10000; 

// १. सेटअप: एआई साँचो र मोडल सेटिङ
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash"; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// २. क्यास (Cache): एआई फेल भयो भने हिजोकै डेटा देखाउन
let rasifalCache = {
    date: "",
    data: null
};

app.get('/api/rasifal', async (req, res) => {
    try {
        const today = new Date().toISOString().split("T")[0];

        // ३. यदि आजको डेटा पहिले नै क्यासमा छ भने एआईलाई नबोलाई सिधै दिने
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

        // ४. तपाईँको योजना अनुसारको कडा र सरल निर्देशन (Prompt)
        const prompt = `तपाईं एक अनुभवी नेपाली ज्योतिषी हुनुहुन्छ। 
        आजको मिति ${today} को लागि मेष देखि मीन सम्मका १२ वटै राशिको दैनिक राशिफल लेख्नुहोस्।
        - भाषा एकदम सरल र सकारात्मक नेपाली हुनुपर्छ।
        - राशिको नाम बाहेक (चु, चे, चो...) जस्ता कुनै पनि ब्र्याकेट वा अक्षरहरू नलेख्नुहोस्।
        - जवाफ केवल JSON Array मा हुनुपर्छ: [{"sign": "मेष", "prediction": "..."}, ...] 
        - अनिवार्य रूपमा १२ वटै राशि समावेश हुनुपर्छ।`;

        // ५. टाइमआउट: एआईलाई १५ सेकेन्डभन्दा बढी कुर्न नदिने
        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error("AI_TIMEOUT")), 15000))
        ]);

        const responseText = result.response.text().replace(/```json|```/g, '').trim();
        const finalData = JSON.parse(responseText);

        // सफल डेटालाई क्यासमा सेभ गर्ने
        rasifalCache = { date: today, data: finalData };

        res.json({
            status: "SUCCESS",
            updatedAt: today,
            source: "GEMINI_AI",
            data: finalData
        });

    } catch (e) {
        console.error("⚠️ Error Occurred:", e.message);

        // ६. फलब्याक: एआई फेल भयो भने पुरानो सुरक्षित डेटा पठाउने
        if (rasifalCache.data) {
            return res.json({
                status: "OFFLINE_SUCCESS",
                updatedAt: rasifalCache.date,
                source: "LAST_SAFE_CACHE",
                data: rasifalCache.data
            });
        }

        res.status(500).json({ 
            status: "ERROR", 
            message: "एआई साँचो वा मोडलमा समस्या छ। कृपया साँचो सक्रिय छ कि छैन चेक गर्नुहोस्।" 
        });
    }
});

// होमपेज
app.get('/', (req, res) => res.send('AI Rasifal Server is Online! 🚀'));

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
