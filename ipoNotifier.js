const express = require("express");
const router = express.Router();
const Parser = require("rss-parser");
const axios = require("axios");
const cron = require("node-cron");
const { GoogleGenAI } = require("@google/genai");

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const parser = new Parser();

// RSS Feeds List
const RSS_FEEDS = [
  "https://arthasansar.com/rss",
  "https://arthasarokar.com/feed",
  "https://www.arthapath.com/feed/",
  "https://www.capitalnepal.com/feed",
  "https://aarthiknews.com/rss/"
];

// Keywords Setup
const NEGATIVE_KEYWORDS = [
  "स्थगित", "स्थगन", "बन्द गरिएको", "बन्द भएको", "रोक्का", 
  "स्टे अर्डर", "आवेदन दिन नपाइने", "रद्द गरिएको", "फारम बन्द"
];

const CORE_KEYWORDS = [
  "आईपीओ", "IPO", "साधारण सेयर", "एफपीओ", "FPO", 
  "हकप्रद सेयर", "Right Share", "डिबेन्चर", "Debenture", "बाँडफाँड", "Allotment", "नतिजा", "Result"
];

const ACTION_KEYWORDS = [
  "आईपीओ खुल्यो", "सार्वजनिक निष्कासन खुला", "आवेदन खुला", 
  "आजदेखि आईपीओ", "बाँडफाँड सम्पन्न", "नतिजा सार्वजनिक", "को नतिजा आयो"
];

// In-Memory Database (Storage)
let ipoNotifications = [];
let processedUrls = new Set();

// Dynamic Model Discovery (Gemini models आफै फेला पार्ने सिस्टम)
async function getAvailableGeminiModels() {
  try {
    const pager = await ai.models.list({ config: { pageSize: 50 } });
    const discovered = [];

    for await (const model of pager) {
      const name = model?.baseModelId || (model?.name ? model.name.replace(/^models\//, "") : "");
      if (!name) continue;

      const lowerName = name.toLowerCase();
      const supportedMethods = model?.supportedGenerationMethods || [];
      
      if (lowerName.startsWith("gemini-") && lowerName.includes("flash") && supportedMethods.includes("generateContent")) {
        discovered.push(name);
      }
    }

    if (discovered.length > 0) {
      return discovered;
    }
  } catch (err) {
    console.warn("⚠️ Model discovery failed, using fallback models:", err.message);
  }

  return ["gemini-2.5-flash", "gemini-flash-latest"];
}

// Scoring Function
function calculateScore(title, content) {
  const text = `${title} ${content}`;
  
  for (const neg of NEGATIVE_KEYWORDS) {
    if (text.includes(neg)) return -50;
  }

  let score = 0;
  for (const core of CORE_KEYWORDS) {
    if (text.includes(core)) score += 20;
  }

  for (const action of ACTION_KEYWORDS) {
    if (text.includes(action)) score += 15;
  }

  return score;
}

// Scrape and AI Process Workflow with Real Mozilla/Chrome Browser Headers
async function processIpoNews() {
  console.log("🔍 [IPO] Checking RSS feeds for new IPO/Results...");

  for (const feedUrl of RSS_FEEDS) {
    try {
      // वेबसाइटलाई ब्लक गर्नबाट बचाउन ३ देखि ६ सेकेन्डको रेन्डम ग्याप
      await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 3000) + 3000));

      // वास्तविक Mozilla Firefox र Windows PC बाट भिजिट गरेको जस्तो देखिने Headers
      const response = await axios.get(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ne,en-US;q=0.7,en;q=0.3',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0'
        },
        timeout: 15000
      });

      // Axios ले तानेको XML डेटालाई Parser मा पठाउने
      const feed = await parser.parseString(response.data);
      
      for (const item of feed.items) {
        const link = item.link || item.guid;
        if (!link || processedUrls.has(link)) continue;

        const title = item.title || "";
        const snippet = item.contentSnippet || item.content || "";
        const score = calculateScore(title, snippet);

        // Threshold check (Must be >= 35)
        if (score >= 35) {
          console.log(`🎯 [IPO] Potential News Found (Score: ${score}): ${title}`);
          processedUrls.add(link);

          const models = await getAvailableGeminiModels();
          let aiResult = null;

          const prompt = `
          Timi euta share bajar analyst hau. Tal diye ko news title ra description analyze gara:
          Title: ${title}
          Snippet: ${snippet}

          Yadi yo news naya IPO, Right Share kholiyeko ba IPO ko badband/result sambandhi ho vane matra JSON format deu.
          Yadi aru nai news ho vane {"isValid": false} matra deu.

          JSON Format Output:
          {
            "isValid": true/false,
            "type": "IPO_ALERT" ba "IPO_RESULT",
            "company_name": "Company name in English",
            "title": "Short and attractive notification title for user in Nepali",
            "description": "2 line short description",
            "redirect_target": "WEBVIEW" (yadi IPO_ALERT ho vane) ba "IPO_RESULT_SECTION" (yadi IPO_RESULT ho vane)
          }
          Only return pure JSON. No markdown.
          `;

          for (const modelName of models) {
            try {
              const aiResponse = await ai.models.generateContent({
                model: modelName,
                contents: prompt
              });

              const rawText = aiResponse.text.replace(/```json|```/g, "").trim();
              aiResult = JSON.parse(rawText);
              if (aiResult) break;
            } catch (modelErr) {
              // अर्को मोडल ट्राइ गर्ने
            }
          }

          if (aiResult && aiResult.isValid) {
            const newNotification = {
              id: `ipo_${Date.now()}`,
              type: aiResult.type || "IPO_ALERT",
              title: aiResult.title || title,
              description: aiResult.description || snippet.substring(0, 100),
              company_name: aiResult.company_name || "Company",
              image_url: item.enclosure?.url || "https://technokd.com/wp-content/uploads/default-ipo.jpg",
              redirect_target: aiResult.redirect_target || "WEBVIEW",
              source_url: link,
              published_at: new Date().toISOString(),
              is_active: true
            };

            ipoNotifications.unshift(newNotification);
            if (ipoNotifications.length > 20) ipoNotifications.pop();

            console.log(`✅ [IPO] New Valid Notification Added: ${newNotification.title}`);
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ [IPO] Error fetching feed from ${feedUrl}: ${err.message}`);
    }
  }
}

// CRON SCHEDULE: हरेक ३ घण्टामा चल्ने (दिनको ८ पटक) -> `0 */3 * * *`
cron.schedule("0 */3 * * *", () => {
  console.log("⏰ [IPO Cron] Running scheduled 3-hour IPO check...");
  processIpoNews();
}, {
  scheduled: true,
  timezone: "Asia/Kathmandu"
});

// Run once on startup after 10 seconds delay
setTimeout(() => {
  processIpoNews();
}, 10000);

// API ENDPOINT FOR APP
router.get("/ipo-alerts", (req, res) => {
  res.json({
    status: true,
    message: "Latest IPO Notifications fetched successfully",
    total: ipoNotifications.length,
    data: ipoNotifications
  });
});

module.exports = router;
