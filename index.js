const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

app.get('/', (req, res) => {
    res.send('<h1>Rasifal API Server Online!</h1><a href="/api/rasifal">Click here for JSON Data</a>');
});

async function scrapeData() {
    try {
        const response = await axios.get('https://nepalipatro.com.np/nepali-rashifal', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        const $ = cheerio.load(response.data);
        const signs = { 'मेष': '#aries', 'वृष': '#taurus', 'मिथुन': '#gemini', 'कर्कट': '#cancer', 'सिंह': '#leo', 'कन्या': '#virgo', 'तुला': '#libra', 'वृश्चिक': '#scorpio', 'धनु': '#sagittarius', 'मकर': '#capricorn', 'कुम्भ': '#aquarius', 'मीन': '#pisces' };
        
        let results = [];
        for (let sign in signs) {
            // यो नयाँ लजिकले अब एउटा पनि राशि खाली छोड्दैन
            let text = $(signs[sign]).find('.social-body').text().trim() || 
                       $(signs[sign]).find('.rashifal-detail').text().trim() ||
                       $(signs[sign]).find('p').text().trim() ||
                       $(signs[sign]).text().trim();
            
            if (text && text.length > 20) {
                // मेष - , वृष : जस्ता अनावश्यक शब्द हटाउने
                text = text.replace(new RegExp(`^${sign}\\s*[-\\:]*\\s*`, 'i'), '').trim();
                results.push({ sign, prediction: text });
            }
        }
        return results;
    } catch (e) { return []; }
}

async function getAIResponse(rawData) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        let input = rawData.map(d => `${d.sign}: ${d.prediction}`).join('\n');
        const prompt = `तपाईं एक नेपाली राशिफल सम्पादक हुनुहुन्छ। तलको राशिफललाई २ छोटा वाक्यमा सरल नेपालीमा लेख्नुहोस्। 
        सुरुमा आउने "-", ":", वा "चु, चे" जस्ता सबै चिन्ह र अनावश्यक अक्षर हटाउनुहोस्। 
        "BoManma" लाई "मनमा" बनाउनुहोस्। जवाफ मात्र JSON Array मा दिनुहोस्।
        Format: [{"sign": "...", "prediction": "..."}]\n\nINPUT:\n${input}`;
        
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, '').trim();
        return JSON.parse(text);
    } catch (e) { return null; }
}

app.get('/api/rasifal', async (req, res) => {
    let rawData = await scrapeData();
    if (rawData.length === 0) return res.json({ error: "वेबसाइटबाट डाटा आएन" });

    let finalData = await getAIResponse(rawData);

    // यदि AI फेल भयो भने काँचो डाटालाई नै सफा गरेर पठाउने
    if (!finalData) {
        finalData = rawData.map(d => ({
            sign: d.sign,
            prediction: d.prediction.replace(/^[:\s\-,.\u0900-\u097F]+/, '').trim()
        }));
    }
    res.json({ data: finalData });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));