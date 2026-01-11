const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Render को Environment Variables मा यो की हुनुपर्छ
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Rasifal API - Hamro Patro Clean Version</h1><a href="/api/rasifal">Check Data</a>');
});

// १. हाम्रो पात्रोबाट डाटा तान्ने र म्यानुअली सफा गर्ने फङ्सन
async function getCleanScrapedData() {
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
            let rawPrediction = $(el).find('.desc p').text().trim();
            
            if (sign && rawPrediction.length > 20) {
                // म्यानुअल फिल्टर: राशिफलको सुरुबाट 'सिंह (मा, मि...)' हटाउने
                let cleanPrediction = rawPrediction.replace(new RegExp(`^${sign}\\s*\\(.*?\\)`, 'g'), '').trim();
                
                // अन्त्यबाट 'आजको शुभ रंग...' हटाउने
                cleanPrediction = cleanPrediction.split("आजको शुभ रंग")[0].split("शुभ रंग:")[0].trim();
                
                results.push({ sign, prediction: cleanPrediction });
            }
        });
        return results;
    } catch (e) {
        console.error("Scraping Error:", e.message);
        return [];
    }
}

app.get('/api/rasifal', async (req, res) => {
    console.log("📡 डाटा तान्दै...");
    let scrapedData = await getCleanScrapedData();
    
    if (scrapedData.length === 0) {
        return res.json({ error: "हाम्रो पात्रोबाट डाटा तान्न सकिएन।" });
    }

    try {
        console.log("🤖 एआईले प्रोसेस गर्दैछ...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // एआईलाई दिइने कडा निर्देशन
        const prompt = `तपाईं एक प्रोफेसनल नेपाली राशिफल सम्पादक हुनुहुन्छ। 
        तल दिइएको प्रत्येक राशिको राशिफललाई ४ वटा छोटा र सरल नेपाली वाक्यमा लेख्नुहोस्। 
        कुनै पनि राशिको सुरुमा नाम र ब्र्याकेट भित्रका अक्षरहरू (जस्तै: मेष (चु, चे...)) नराख्नुहोस्। 
        शुभ रंग र शुभ अंकको बारेमा केही पनि नलेख्नुहोस्। 
        जवाफ मात्र JSON Array मा दिनुहोस्: [{"sign": "...", "prediction": "..."}]\n\nDATA: ${JSON.stringify(scrapedData)}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // JSON डाटा निकाल्ने
        let finalJson = JSON.parse(responseText.replace(/```json|```/g, '').trim());
        res.json({ data: finalJson });

    } catch (e) {
        // यदि एआई फेल भयो भने म्यानुअली सफा गरिएको डाटा पठाउने
        console.log("⚠️ AI failed, sending manually cleaned data.");
        res.json({ data: scrapedData });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
