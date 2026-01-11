const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Hamro Patro Rasifal API - Live</h1><a href="/api/rasifal">Check Data</a>');
});

async function scrapeHamroPatro() {
    try {
        const url = 'https://www.hamropatro.com/rashifal';
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let results = [];
        
        // हाम्रो पात्रोको नयाँ स्ट्रक्चर अनुसार डाटा तान्ने लजिक
        $('.item').each((i, el) => {
            const sign = $(el).find('h3').text().trim();
            const prediction = $(el).find('.desc p').text().trim();
            
            if (sign && prediction.length > 20) {
                // अगाडिका अनावश्यक चिन्ह र अक्षर हटाउने
                const cleanPrediction = prediction.replace(new RegExp(`^${sign}\\s*[-\\:]*\\s*`, 'i'), '').trim();
                results.push({ sign, prediction: cleanPrediction });
            }
        });

        return results;
    } catch (e) {
        console.error("Scraping failed:", e.message);
        return [];
    }
}

app.get('/api/rasifal', async (req, res) => {
    console.log("📡 हाम्रो पात्रोबाट डाटा तान्दै...");
    let rawData = await scrapeHamroPatro();
    
    if (rawData.length === 0) {
        return res.json({ error: "हाम्रो पात्रोबाट डाटा आएन। कृपया फेरि प्रयास गर्नुहोस्।" });
    }

    try {
        console.log("🤖 एआईले टेक्स्ट सफा गर्दैछ...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `तपाईं एक नेपाली राशिफल सम्पादक हुनुहुन्छ। यो राशिफललाई २ छोटा वाक्यमा सरल नेपालीमा लेख्नुहोस्। सबै अनावश्यक चिन्ह हटाउनुहोस्। जवाफ JSON Array मा मात्र दिनुहोस्: [{"sign": "...", "prediction": "..."}]\n\nINPUT: ${JSON.stringify(rawData)}`;
        
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        res.json({ data: JSON.parse(text) });
    } catch (e) {
        // AI फेल भएमा काँचो डाटा पठाउने
        res.json({ data: rawData });
    }
});

app.listen(PORT, () => console.log(`🚀 Hamro Patro Server on port ${PORT}`));
