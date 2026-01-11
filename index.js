const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// १. साथीको सुझाव: Model Versioning & ENV Variable
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash-latest";
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// २. साथीको सुझाव: Simple In-Memory Cache
let rasifalCache = {
    date: "",
    data: null
};

// ३. साथीको सुझाव: Timeout Protection (८ सेकेन्ड)
async function callGeminiWithTimeout(sign, rawPrediction) {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const prompt = `तपाईं एक प्रोफेसनल नेपाली सम्पादक हुनुहुन्छ। '${sign}' राशिको राशिफलबाट सुरुमा आउने नाम, ब्र्याकेटका अक्षरहरू, र अन्तको शुभ रंग/अंक हटाउनुहोस्। केवल २ वाक्यमा मुख्य राशिफल मात्र लेख्नुहोस्।\n\nINPUT: ${rawPrediction}`;

    try {
        // Promise.race ले एआई ८ सेकेन्डमा नफर्किए 'Timeout' गरिदिन्छ
        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error("AI Timeout")), 8000))
        ]);
        return result.response.text().trim();
    } catch (e) {
        console.log(`⚠️ AI Error for ${sign}: ${e.message}. Using Manual Fallback.`);
        // Fallback: एआई फेल भए कोड आफैँले टेक्स्ट सफा गर्छ
        return rawPrediction.replace(/^.*?\)\s*/, '').split("आजको शुभ रंग")[0].trim();
    }
}

app.get('/api/rasifal', async (req, res) => {
    // ४. Caching Logic: यदि आजकै डाटा छ भने तुरुन्तै पठाउने (⚡ Fast)
    const today = new Date().toISOString().split("T")[0];
    if (rasifalCache.date === today && rasifalCache.data) {
        console.log("🚀 Serving from Cache");
        return res.json({
            status: "SUCCESS",
            cached: true,
            updatedAt: rasifalCache.date,
            data: rasifalCache.data
        });
    }

    try {
        console.log("📡 Scraping Hamro Patro...");
        const response = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
        const $ = cheerio.load(response.data);
        
        let scrapedData = [];
        $('.item').each((i, el) => {
            const sign = $(el).find('h3').text().trim();
            const text = $(el).find('.desc p').text().trim();
            if (sign && text.length > 20) scrapedData.push({ sign, text });
        });

        let finalResults = [];
        for (let item of scrapedData) {
            console.log(`- Processing ${item.sign}...`);
            const cleanText = await callGeminiWithTimeout(item.sign, item.text);
            finalResults.push({ sign: item.sign, prediction: cleanText });
        }

        // ५. नयाँ डाटा क्यासमा सेभ गर्ने
        rasifalCache = { date: today, data: finalResults };

        // ६. साथीको सुझाव: Strong API Response
        res.json({
            status: "SUCCESS",
            source: "hamropatro",
            ai: true,
            updatedAt: today,
            data: finalResults
        });

    } catch (e) {
        res.status(500).json({ status: "ERROR", message: e.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
