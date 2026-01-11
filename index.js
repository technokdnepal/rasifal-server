const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Rasifal API Status: Active</h1><a href="/api/rasifal">Check Data</a>');
});

async function scrapeFromSource(url) {
    try {
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ne-NP,ne;q=0.9,en-US;q=0.8'
            }
        });
        return response.data;
    } catch (e) {
        console.error(`Error fetching from ${url}:`, e.message);
        return null;
    }
}

async function getRawRashifal() {
    const signs = ['मेष', 'वृष', 'मिथुन', 'कर्कट', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुम्भ', 'मीन'];
    
    // १. मुख्य साइट प्रयास गर्ने
    let html = await scrapeFromSource('https://nepalipatro.com.np/nepali-rashifal');
    
    // २. यदि पहिलोले ब्लक गरेमा ब्याकअप साइट प्रयास गर्ने
    if (!html) {
        html = await scrapeFromSource('https://www.asali-nepalipatro.com/rashifal');
    }

    if (!html) return [];

    const $ = cheerio.load(html);
    let results = [];

    // यो लजिकले अब वेबसाइटको जुनसुकै कुनामा भएको टेक्स्ट तान्छ
    $('div, p, span, h3').each((i, el) => {
        let text = $(el).text().trim();
        signs.forEach(sign => {
            if (text.startsWith(sign) && text.length > 50 && !results.find(r => r.sign === sign)) {
                results.push({ 
                    sign, 
                    prediction: text.replace(sign, '').replace(/^[:\-\s\.\d]+/, '').trim() 
                });
            }
        });
    });

    return results;
}

app.get('/api/rasifal', async (req, res) => {
    console.log("📡 डाटा तान्ने प्रयास गर्दै...");
    let rawData = await getRawRashifal();
    
    if (rawData.length < 5) {
        return res.json({ error: "वेबसाइटले अझै ब्लक गरिरहेको छ। कृपया केही मिनेट पछि फेरि प्रयास गर्नुहोस् वा सर्भर रिस्टार्ट गर्नुहोस्।" });
    }

    try {
        console.log("🤖 एआईले टेक्स्ट सफा गर्दैछ...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let prompt = `तपाईं एक नेपाली राशिफल सम्पादक हुनुहुन्छ। यो राशिफललाई २ छोटा वाक्यमा सरल नेपालीमा लेख्नुहोस्। चिन्ह र अनावश्यक अक्षर हटाउनुहोस्। जवाफ JSON Array मा दिनुहोस्: [{"sign": "...", "prediction": "..."}]\n\nINPUT: ${JSON.stringify(rawData)}`;
        
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        res.json({ data: JSON.parse(text) });
    } catch (e) {
        // एआई फेल भएमा काँचो डाटा पठाउने
        res.json({ data: rawData });
    }
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
