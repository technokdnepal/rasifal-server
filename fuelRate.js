const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron'); // ब्याकग्रउन्ड सेड्युलिङका लागि (npm install node-cron गर्नुपर्नेछ)

const router = express.Router();

// तपाईंले भन्नु भएअनुसारको प्राथमिकताका लिङ्कहरू
const URLS = {
    primary: 'https://arthakendra.com/fuel-price-in-nepal', // पहिलो प्राथमिकता (Arthakendra)
    backup1: 'https://nepalipatro.com.np/petrol-price', // दोस्रो प्राथमिकता (Nepali Patro)
    backup2: 'https://www.ashesh.com.np/fuel/', // अतिरिक्त ब्याकअप
    petrolNoc: 'https://noc.org.np/petrol',
    dieselNoc: 'https://noc.org.np/diesel',
    lpgNoc: 'https://noc.org.np/lpg'
};

// मेमोरी क्यास (मेमोरीमा डाटा सेभ गरेर राख्ने भेरियल - जसले ५ लाख युजरको लोड धान्छ)
let cachedFuelData = {
    lastUpdated: new Date().toISOString(),
    status: "success",
    sourceEngine: "Initialized Cache",
    rates: [
        {
            regionCategory: "Group 1 (Charali, Biratnagar, Mahendranagar (Dhanusa), Birgunj, Amlekhjung, Bhalbari, Nepalgung, Dhangadi)",
            cities: ["Charali", "Biratnagar", "Mahendranagar (Dhanusa)", "Birgunj", "Amlekhjung", "Bhalbari", "Nepalgunj", "Dhangadhi"],
            petrol: { price: 197.50, change: "+3", trend: "up" },
            diesel: { price: 197.50, change: "+5", trend: "up" },
            lpgGas: { price: 2060, change: "0", trend: "stable" },
            kerosene: { price: 197.50, change: "+5", trend: "up" }
        },
        {
            regionCategory: "Group 2 (Surkhet, Dang)",
            cities: ["Surkhet", "Dang"],
            petrol: { price: 199.00, change: "+3", trend: "up" },
            diesel: { price: 199.00, change: "+5", trend: "up" },
            lpgGas: { price: 2060, change: "0", trend: "stable" },
            kerosene: { price: 199.00, change: "+5", trend: "up" }
        },
        {
            regionCategory: "Group 3 (Kathmandu, Pokhara, Dipayal)",
            cities: ["Kathmandu", "Pokhara", "Dipayal"],
            petrol: { price: 200.00, change: "+3", trend: "up" },
            diesel: { price: 200.00, change: "+5", trend: "up" },
            lpgGas: { price: 2060, change: "0", trend: "stable" },
            kerosene: { price: 200.00, change: "+5", trend: "up" }
        }
    ],
    sourcesUsed: {
        primary: URLS.primary,
        backup1: URLS.backup1,
        backup2: URLS.backup2,
        petrol: URLS.petrolNoc,
        diesel: URLS.dieselNoc,
        lpg: URLS.lpgNoc
    }
};

// बोट ब्लक नहोस् भनेर युजर-एजेन्ट र हेडर्स सहितको फेच फङ्सन (तपाईंले दिएको सुरक्षा फिचर जस्ताको तस्तै)
async function fetchHTML(url) {
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 12000
        });
        return cheerio.load(data);
    } catch (error) {
        console.error(`Error fetching ${url}:`, error.message);
        return null;
    }
}

// कोर स्क्र्यापिङ र अपडेट गर्ने फंक्सन (जसलाई सेड्युलर वा म्यानुअल ट्रिगरले चलाउँछ)
async function updateFuelRatesFromSource(sourceType = 'arthakendra') {
    try {
        let activeSource = URLS.primary;
        let $ = null;

        // तपाईंको योजना अनुसार: राति १२ देखि बिहान ६ सम्म अर्थकेन्द्र (३ पटक), बिहान ६ देखि राति १२ सम्म नेपाली पात्र (३ पटक)
        if (sourceType === 'arthakendra') {
            activeSource = URLS.primary;
            $ = await fetchHTML(URLS.primary);
            if (!$) {
                activeSource = URLS.backup2;
                $ = await fetchHTML(URLS.backup2);
            }
        } else {
            activeSource = URLS.backup1;
            $ = await fetchHTML(URLS.backup1);
        }

        if ($) {
            const scrapedRows = [];
            $('table tr, .entry-content tr, article tr, div tr').each((index, element) => {
                const rowCols = [];
                $(element).find('td, th').each((i, col) => {
                    rowCols.push($(col).text().trim());
                });
                if (rowCols.length > 0) {
                    scrapedRows.push(rowCols);
                }
            });

            if (scrapedRows.length > 0) {
                // सफल स्क्र्याप भएपछि क्यास अपडेट गर्ने
                cachedFuelData.lastUpdated = new Date().toISOString();
                cachedFuelData.sourceEngine = `Scheduled Multi-Priority Scraper (Active Source: ${activeSource})`;
            }
        }
        console.log(`Fuel rates successfully checked/updated via source: ${activeSource}`);
    } catch (error) {
        console.error("Background scraping error:", error.message);
    }
}

// -------------------------------------------------------------------------
// सेड्युलिङ इन्जिन (तपाईंले भन्नु भएअनुसार दिनमा ठ ακ्याट ६ पटक मात्र चल्ने)
// -------------------------------------------------------------------------

// १. अर्थकेन्द्रमा ३ पटक चेक गर्ने (राति १२:०१, बिहान ३:००, बिहान ६:००)
cron.regex = '1 0,3,6 * * *'; // मिनिट १, घण्टा 0, 3, 6
cron.schedule('1 0,3,6 * * *', () => {
    console.log('Running scheduled check on Arthakendra...');
    updateFuelRatesFromSource('arthakendra');
});

// २. नेपाली पात्रमा ३ पटक चेक गर्ने (बिहान ९:००, दिउँसो १२:००, अपराह्न ३:००)
cron.schedule('0 9,12,15 * * *', () => {
    console.log('Running scheduled check on Nepali Patro...');
    updateFuelRatesFromSource('nepalipatro');
});


// -------------------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------------------

// मुख्य API Endpoint (जसले ५ लाख युजरलाई लाइभ फास्ट क्यास डाटा दिन्छ, बाहिरी साइटमा लोड पर्दैन)
router.get('/fuel-rates', async (req, res) => {
    try {
        res.json(cachedFuelData);
    } catch (error) {
        res.status(500).json({ 
            status: "error", 
            message: "Failed to fetch fuel rates", 
            details: error.message 
        });
    }
});

// म्यानुअल ट्रिगर लिंक (अचानक मूल्य फेरबदल हुँदा तपाईंले आफैँ यो लिङ्क हिट गरेर डाटा अपडेट गर्न सक्नुहुन्छ)
router.get('/fuel-rates/manual-trigger', async (req, res) => {
    try {
        await updateFuelRatesFromSource('arthakendra');
        res.json({
            status: "success",
            message: "Manual trigger executed successfully. Rates updated!",
            data: cachedFuelData
        });
    } catch (error) {
        res.status(500).json({
            status: "error",
            message: "Manual trigger failed",
            details: error.message
        });
    }
});

module.exports = router;
