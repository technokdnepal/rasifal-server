const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
require('dotenv').config();

process.env.TZ = 'Asia/Kathmandu';

const app = express();
const PORT = process.env.PORT || 10000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.1-8b-instant';

let rasifalCache = { 
    date: null, 
    data: [], 
    source: "AI Unique Interpretation (Traditional Nepali)" 
};

// १. राशिको नाम म्यापिङ (कन्फ्युजन हटाउन)
const zodiacMap = "Aries: मेष, Taurus: वृष, Gemini: मिथुन, Cancer: कर्कट, Leo: सिंह, Virgo: कन्या, Libra: तुला, Scorpio: वृश्चिक, Sagittarius: धनु, Capricorn: मकर, Aquarius: कुम्भ, Pisces: मीन";

// २. स्क्र्यापर: डेटा तान्ने
async function getRawData() {
    try {
        const res = await axios.get('https://www.hamropatro.com/rashifal', { timeout: 15000 });
        const $ = cheerio.load(res.data);
        let content = "";
        $('.item').each((i, el) => {
            content += $(el).find('.title').text() + ": " + $(el).find('.desc').text() + "\n";
        });
        return content;
    } catch (e) {
        console.error("Scraping Error:", e.message);
        return null;
    }
}

// ३. एआई प्रोसेसिङ (५-६ वाक्य र कोपी-पेस्ट रोक्ने कडा नियम)
async function updateRasifal() {
    console.log("⏳ मौलिक राशिफल तयार हुँदैछ (५-६ वाक्यको नियम)...");
    const rawData = await getRawData();
    if (!rawData) return false;

    const prompt = `
    You are a Native Nepali Content Writer and Astrologer for 'technokd.com'.
    
    TASK:
    1. Read the raw data and understand the inner meaning of each zodiac sign.
    2. Do NOT translate word-to-word.
    3. WRITE an original 5-sentence paragraph for each sign in "Natural, Flowing Nepali" (मीठो र ठेट नेपाली).
    
    STRICT GUIDELINES for 'Natural Feel':
    - Start each sign differently. Avoid "यो राशिका व्यक्ति" or "आजको दिन".
    - Use natural phrases like: "समयले साथ दिने देखिन्छ", "सचेत रहनु बुद्धिमानी हुनेछ", "मनमा उत्साह बढ्नेछ".
    - No English words like 'millennial' or 'professional' in Nepali text.
    - Write it like a human newspaper columnist, not a robot.

    OUTPUT JSON:
    { "data": [ {"sign": "मेष", "prediction": "...(5-6 natural Nepali sentences)..."}, ... ] }

    SOURCE: ${rawData}
    `;

    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions',
            {
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.8
            },
            { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } }
        );

        const aiOutput = JSON.parse(response.data.choices[0].message.content);
        
        if (aiOutput.data && aiOutput.data.length > 0) {
            // अन्तिम सफाइ: एआईले झुक्किएर कोपी गरेका केही शब्दहरूलाई अटो-रिप्लेस गर्ने
            const finalData = aiOutput.data.map(item => ({
                sign: item.sign,
                prediction: item.prediction
                    .replace(/आर्थिक लेनदेनमा सतर्कता अपनाउनुहोस्/g, "आर्थिक मामिलामा विशेष सावधानी राख्नुहोला")
                    .replace(/दाम्पत्य जीवन सुमधुर रहनेछ/g, "पारिवारिक सम्बन्धमा सुखद वातावरण रहनेछ")
                    .replace(/आजको दिनमा /g, "") // 'आजको दिनमा' हटाइने
            }));

            rasifalCache.data = finalData;
            rasifalCache.date = new Date().toISOString().split('T')[0];
            console.log("✅ ५-६ वाक्यको मौलिक राशिफल तयार भयो।");
            return true;
        }
    } catch (e) {
        console.error("AI Error:", e.message);
        return false;
    }
}

// ४. सेड्युलर र एण्डपोइन्ट्स
cron.schedule('10 0 * * *', updateRasifal);

app.get('/api/rasifal', async (req, res) => {
    if (!rasifalCache.data || rasifalCache.data.length === 0) await updateRasifal();
    res.json({
        status: "SUCCESS",
        updatedAt: rasifalCache.date,
        data: rasifalCache.data
    });
});

app.get('/api/rasifal/force-update', async (req, res) => {
    const success = await updateRasifal();
    res.json({ status: success ? "SUCCESS" : "ERROR" });
});

app.listen(PORT, () => {
    console.log(`🚀 सर्भर पोर्ट ${PORT} मा चल्दैछ।`);
    updateRasifal(); // सुरुमै एकपटक रन गर्ने
});
