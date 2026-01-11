const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Rasifal API Online!</h1><a href="/api/rasifal">Check Data</a>');
});

async function scrapeData() {
    try {
        // पूर्ण ब्राउजर जस्तै रिक्वेस्ट पठाउने
        const response = await axios.get('https://nepalipatro.com.np/nepali-rashifal', {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ne,en-US;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache'
            }
        });

        const $ = cheerio.load(response.data);
        const signs = { 
            'मेष': '#aries', 'वृष': '#taurus', 'मिथुन': '#gemini', 'कर्कट': '#cancer', 
            'सिंह': '#leo', 'कन्या': '#virgo', 'तुला': '#libra', 'वृश्चिक': '#scorpio', 
            'धनु': '#sagittarius', 'मकर': '#capricorn', 'कुम्भ': '#aquarius', 'मीन': '#pisces' 
        };
        
        let results = [];
        for (let sign in signs) {
            // यो लजिकले अब एउटा पनि राशि खाली छोड्दैन (Even if dynamic content)
            let text = $(signs[sign]).find('.social-body').text().trim() || 
                       $(signs[sign]).find('.rashifal-detail').text().trim() ||
                       $(signs[sign]).find('div.card-body').text().trim() ||
                       $(signs[sign]).text().trim();
            
            // केवल सार्थक टेक्स्ट मात्र लिने
            if (text.length > 30) {
                // अगाडिको राशिको नाम र चिन्ह हटाउने
                text = text.replace(new RegExp(`^${sign}\\s*[-\\:]*\\s*`, 'i'), '').trim();
                results.push({ sign, prediction: text });
            }
        }
        return results;
    } catch (e) {
        console.log("Error Details:", e.message);
        return [];
    }
}

async function getAIResponse(rawData) {
    try {
        if (!process.env.GEMINI_API_KEY) return null;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let input = rawData.map(d => `${d.sign}: ${d.prediction}`).join('\n');
        
        const prompt = `तपाईं एक नेपाली सम्पादक हुनुहुन्छ। तलको राशिफललाई २ छोटा वाक्यमा सरल नेपालीमा लेख्नुहोस्। 
        सुरुमा आउने "-", ":", वा "चु, चे" जस्ता सबै चिन्ह र अनावश्यक अक्षर हटाउनुहोस्। 
        Output strictly JSON Array: [{"sign": "...", "prediction": "..."}]\n\nINPUT:\n${input}`;
        
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (e) { return null; }
}

app.get('/api/rasifal', async (req, res) => {
    console.log("📡 डाटा तान्दै...");
    let rawData = await scrapeData();
    
    if (rawData.length === 0) {
        return res.json({ error: "वेबसाइटले ब्लक गर्यो वा डाटा भेटिएन" });
    }

    console.log("🤖 एआईले प्रोसेस गर्दैछ...");
    let finalData = await getAIResponse(rawData);

    if (!finalData) {
        finalData = rawData.map(d => ({
            sign: d.sign,
            prediction: d.prediction.replace(/^[:\s\-,.\u0900-\u097F]+/, '').trim()
        }));
    }
    res.json({ data: finalData });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
