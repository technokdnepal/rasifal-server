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

async function scrapeWithStealth() {
    const signs = ['मेष', 'वृष', 'मिथुन', 'कर्कट', 'सिंह', 'कन्या', 'तुला', 'वृश्चिक', 'धनु', 'मकर', 'कुम्भ', 'मीन'];
    // ब्लक हुनबाट बच्न फरक-फरक लिङ्कहरू प्रयास गर्ने
    const urls = [
        'https://nepalipatro.com.np/nepali-rashifal',
        'https://www.nepalipatro.com.np/nepali-rashifal'
    ];
    
    for (let url of urls) {
        try {
            const response = await axios.get(url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'ne-NP,ne;q=0.9,en-US;q=0.8,en;q=0.7',
                    'Referer': 'https://www.google.com/',
                    'Connection': 'keep-alive'
                }
            });

            const $ = cheerio.load(response.data);
            let results = [];

            // वेबसाइटको कुनै पनि ठाउँमा लुकेको टेक्स्ट तान्ने लजिक
            $('div, p, span').each((i, el) => {
                let text = $(el).text().trim();
                signs.forEach(sign => {
                    if (text.startsWith(sign) && text.length > 40 && !results.find(r => r.sign === sign)) {
                        results.push({ 
                            sign, 
                            prediction: text.replace(sign, '').replace(/^[:\-\s]+/, '').trim() 
                        });
                    }
                });
            });

            if (results.length >= 8) return results; // धेरैजसो राशि भेटिए सफल मान्ने
        } catch (e) {
            console.error(`Error with ${url}:`, e.message);
        }
    }
    return [];
}

async function cleanWithAI(rawData) {
    try {
        if (!process.env.GEMINI_API_KEY) return null;
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let prompt = `तपाईं एक नेपाली राशिफल सम्पादक हुनुहुन्छ। तलको राशिफललाई २ छोटा वाक्यमा सरल नेपालीमा लेख्नुहोस्। 
        अगाडिका सबै चिन्ह र अनावश्यक अक्षर हटाउनुहोस्। जवाफ JSON Array मा मात्र दिनुहोस्।\n\nINPUT: ${JSON.stringify(rawData)}`;
        
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (e) { return null; }
}

app.get('/api/rasifal', async (req, res) => {
    let rawData = await scrapeWithStealth();
    
    if (rawData.length === 0) {
        return res.json({ error: "वेबसाइटले ब्लक गरिरहेको छ। कृपया केही मिनेट पछि फेरि प्रयास गर्नुहोस् वा सर्भर रिस्टार्ट गर्नुहोस्।" });
    }

    let finalData = await cleanWithAI(rawData);
    res.json({ data: finalData || rawData });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
