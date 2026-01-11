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

async function fetchWithRetry() {
    const signs = ['मेष', 'वृष', 'मिथुन', 'कर्कट', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुम्भ', 'मीन'];
    const url = 'https://nepalipatro.com.np/nepali-rashifal';
    
    try {
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ne,en-US;q=0.9,en;q=0.8',
            }
        });

        const $ = cheerio.load(response.data);
        let results = [];

        // यो लजिकले अब वेबसाइटको कुनै पनि कुनामा भएको टेक्स्ट तान्छ
        $('.social-body, .rashifal-detail, div.card-body, p').each((i, el) => {
            let text = $(el).text().trim();
            signs.forEach(sign => {
                if (text.startsWith(sign) && text.length > 40 && !results.find(r => r.sign === sign)) {
                    results.push({ sign, prediction: text.replace(sign, '').replace(/^[:\-\s]+/, '').trim() });
                }
            });
        });

        return results;
    } catch (e) {
        console.error("Scraping error:", e.message);
        return [];
    }
}

async function cleanWithAI(rawData) {
    try {
        if (!process.env.GEMINI_API_KEY) return null;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let prompt = `तपाईं एक नेपाली राशिफल सम्पादक हुनुहुन्छ। तलको राशिफललाई २ छोटा वाक्यमा सरल नेपालीमा लेख्नुहोस्। 
        सुरुमा आउने "-", ":", वा "चु, चे" जस्ता सबै चिन्ह र अनावश्यक अक्षर हटाउनुहोस्। 
        जवाफ मात्र JSON Array मा दिनुहोस्।\n\nINPUT:\n${JSON.stringify(rawData)}`;
        
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (e) { return null; }
}

app.get('/api/rasifal', async (req, res) => {
    let data = await fetchWithRetry();
    
    if (data.length === 0) {
        return res.json({ error: "वेबसाइटले अझै ब्लक गरिरहेको छ। कृपया १ मिनेट पछि फेरि प्रयास गर्नुहोस्।" });
    }

    let finalData = await cleanWithAI(data);
    res.json({ data: finalData || data });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
