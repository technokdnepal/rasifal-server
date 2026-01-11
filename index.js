const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Rasifal API Active!</h1><a href="/api/rasifal">Check Data</a>');
});

// मुख्य स्क्र्यापिङ फङ्सन (Multiple Sources)
async function fetchRasifal() {
    const sources = [
        'https://nepalipatro.com.np/nepali-rashifal',
        'https://www.asali-nepalipatro.com/rashifal' // ब्याकअप साइट
    ];

    for (let url of sources) {
        try {
            const response = await axios.get(url, {
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
            });
            const $ = cheerio.load(response.data);
            const signs = ['मेष', 'वृष', 'मिथुन', 'कर्कट', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुम्भ', 'मीन'];
            let results = [];

            // यो लजिकले अब जुनसुकै क्लासमा भए पनि डाटा खोज्छ
            $('div, p, span').each((i, el) => {
                let text = $(el).text().trim();
                signs.forEach(sign => {
                    if (text.startsWith(sign) && text.length > 50 && !results.find(r => r.sign === sign)) {
                        results.push({ sign, prediction: text.replace(sign, '').trim() });
                    }
                });
            });

            if (results.length >= 6) return results; // यदि आधाभन्दा बढी राशि भेटिए सफल मान्ने
        } catch (e) { console.log(`Source ${url} failed`); }
    }
    return [];
}

async function cleanWithAI(rawData) {
    try {
        if (!process.env.GEMINI_API_KEY) return null;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let prompt = `तपाईं सम्पादक हुनुहुन्छ। तलको राशिफललाई २ वाक्यमा सरल नेपालीमा लेख्नुहोस्। चिन्हहरू हटाउनुहोस्।\n\nJSON: ${JSON.stringify(rawData)}`;
        const result = await model.generateContent(prompt);
        return JSON.parse(result.response.text().replace(/```json|```/g, '').trim());
    } catch (e) { return null; }
}

app.get('/api/rasifal', async (req, res) => {
    let data = await fetchRasifal();
    if (data.length === 0) return res.json({ error: "सबै स्रोतहरूबाट डाटा ब्लक भयो" });

    let aiData = await cleanWithAI(data);
    res.json({ data: aiData || data });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
