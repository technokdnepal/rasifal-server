const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Render मा GEMINI_API_KEY सेट भएको हुनुपर्छ
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Rasifal API - Hamro Patro Version</h1><a href="/api/rasifal">Check Data</a>');
});

// हाम्रो पात्रोबाट डाटा तान्ने फङ्सन
async function scrapeHamroPatro() {
    try {
        const url = 'https://www.hamropatro.com/rashifal';
        const response = await axios.get(url, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' }
        });

        const $ = cheerio.load(response.data);
        let results = [];

        $('.item').each((i, el) => {
            const sign = $(el).find('h3').text().trim();
            let prediction = $(el).find('.desc p').text().trim();
            
            if (sign && prediction.length > 20) {
                // १. कोडबाटै "शुभ रंग/अंक" हटाउने (यदि एआई फेल भयो भने पनि काम गर्छ)
                prediction = prediction.split("आजको शुभ रंग")[0].split("शुभ रंग:")[0].trim();
                results.push({ sign, prediction });
            }
        });
        return results;
    } catch (e) {
        return [];
    }
}

app.get('/api/rasifal', async (req, res) => {
    let rawData = await scrapeHamroPatro();
    
    if (rawData.length === 0) {
        return res.json({ error: "डाटा तान्न सकिएन। Hamro Patro ब्लक भएको हुन सक्छ।" });
    }

    try {
        // एआईलाई कडा निर्देशन: नाम र ब्र्याकेट हटाउन
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `तपाईं एक प्रोफेसनल नेपाली सम्पादक हुनुहुन्छ। 
        तपाईंलाई १२ वटा राशिको लिस्ट दिइएको छ। प्रत्येक राशिको 'prediction' बाट सुरुमा आउने राशिको नाम र ब्र्याकेट भित्रका अक्षरहरू (जस्तै: मेष (चु, चे, चो, ला...) ) अनिवार्य रूपमा हटाउनुहोस्। 
        केवल मुख्य राशिफलको वाक्य मात्र राख्नुहोस्। 
        जवाफ मात्र JSON Array मा दिनुहोस्: [{"sign": "...", "prediction": "..."}]\n\nINPUT DATA: ${JSON.stringify(rawData)}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // JSON सफा गर्ने र पठाउने
        let finalJson = JSON.parse(responseText.replace(/```json|```/g, '').trim());
        res.json({ data: finalJson });
    } catch (e) {
        // एआई फेल भएमा काँचो डाटा पठाउने
        console.error("AI Error:", e.message);
        res.json({ data: rawData });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
