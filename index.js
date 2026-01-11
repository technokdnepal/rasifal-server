const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Render को Environment Variables मा GEMINI_API_KEY हुनुपर्छ
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// १. एउटा राशिलाई मात्र सफा गर्ने एआई फङ्सन
async function callGeminiForSingleSign(sign, rawPrediction) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // एआईलाई कडा निर्देशन
        const prompt = `तपाईं एक प्रोफेसनल नेपाली सम्पादक हुनुहुन्छ। 
        यो '${sign}' राशिको राशिफलबाट सुरुमा आउने नाम र ब्र्याकेट भित्रका अक्षरहरू हटाउनुहोस्। 
        "आजको शुभ रंग..." र "शुभ अंक..." भन्ने भाग पनि हटाउनुहोस्। 
        केवल ३ वाक्यमा मुख्य राशिफल मात्र लेख्नुहोस्। 
        जवाफ मात्र सिधै सफा टेक्स्टमा दिनुहोस्।\n\nINPUT: ${rawPrediction}`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (e) {
        // एआई फेल भएमा म्यानुअली सफा गर्ने
        let fallback = rawPrediction.replace(/^.*?\)\s*/, '').split("आजको शुभ रंग")[0].trim();
        return fallback;
    }
}

app.get('/api/rasifal', async (req, res) => {
    try {
        console.log("📡 हाम्रो पात्रोबाट डाटा तान्दै...");
        const response = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
        const $ = cheerio.load(response.data);
        
        let scrapedData = [];
        $('.item').each((i, el) => {
            const sign = $(el).find('h3').text().trim();
            const text = $(el).find('.desc p').text().trim();
            if (sign && text.length > 20) {
                scrapedData.push({ sign, text });
            }
        });

        // २. तपाईँको विचार अनुसार 'One-by-One' लुप चलाउने
        console.log("🤖 १२ वटै राशिलाई पालैपालो एआईबाट प्रोसेस गर्दैछ...");
        let finalResults = [];
        
        for (let item of scrapedData) {
            console.log(`- ${item.sign} प्रोसेस हुँदैछ...`);
            const cleanPrediction = await callGeminiForSingleSign(item.sign, item.text);
            finalResults.push({
                sign: item.sign,
                prediction: cleanPrediction
            });
        }

        res.json({ data: finalResults, status: "SUCCESS" });

    } catch (e) {
        console.error("Error:", e.message);
        res.json({ error: "डाटा अपडेट गर्न सकिएन", detail: e.message });
    }
});

app.get('/', (req, res) => res.send('Rasifal Server is Online!'));
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
