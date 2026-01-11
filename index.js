const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Rasifal API - Active</h1><a href="/api/rasifal">Check Data</a>');
});

async function scrapeFromSource(url) {
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ne-NP,ne;q=0.9,en-US;q=0.8',
                'Cache-Control': 'no-cache'
            }
        });
        return response.data;
    } catch (e) {
        return null;
    }
}

app.get('/api/rasifal', async (req, res) => {
    const signs = ['मेष', 'वृष', 'मिथुन', 'कर्कट', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुम्भ', 'मीन'];
    
    // १. पहिलो स्रोत: नेपाली पात्रो
    let html = await scrapeFromSource('https://nepalipatro.com.np/nepali-rashifal');
    
    // २. यदि पहिलो फेल भएमा दोस्रो स्रोत: असली नेपाली पात्रो
    if (!html) {
        html = await scrapeFromSource('https://www.asali-nepalipatro.com/rashifal');
    }

    if (!html) {
        return res.json({ error: "सबै स्रोतहरू ब्लक भए। कृपया १ मिनेट पछि प्रयास गर्नुहोस्।" });
    }

    const $ = cheerio.load(html);
    let rawResults = [];

    $('div, p, span, h3').each((i, el) => {
        let text = $(el).text().trim();
        signs.forEach(sign => {
            if (text.startsWith(sign) && text.length > 50 && !rawResults.find(r => r.sign === sign)) {
                rawResults.push({ sign, prediction: text.replace(sign, '').replace(/^[:\-\s\.\d]+/, '').trim() });
            }
        });
    });

    if (rawResults.length < 6) return res.json({ error: "डाटा पूर्ण रूपमा भेटिएन।" });

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `तपाईं सम्पादक हुनुहुन्छ। यो राशिफललाई २ छोटा वाक्यमा सरल नेपालीमा लेख्नुहोस्। चिन्हहरू हटाउनुहोस्। जवाफ JSON Array मा दिनुहोस्: [{"sign": "...", "prediction": "..."}]\n\nINPUT: ${JSON.stringify(rawResults)}`;
        const result = await model.generateContent(prompt);
        let finalJson = JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
        res.json({ data: finalJson });
    } catch (e) {
        res.json({ data: rawResults });
    }
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
