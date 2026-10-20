const express = require("express");
const router = express.Router();
const Parser = require("rss-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const cron = require("node-cron");
const { GoogleGenAI } = require("@google/genai");

// Initialize Gemini AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const parser = new Parser({
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
});

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

// Scoring Function
function calculateScore(title, content) {
  const text = `${title} ${content}`;
  
  // 1. Negative Check
  for (const neg of NEGATIVE_KEYWORDS) {
    if (text.includes(neg)) return -50;
  }

  let score = 0;
  // 2. Core Keywords Check (+20)
  for (const core of CORE_KEYWORDS) {
    if (text.includes(core)) score += 20;
  }

  // 3. Action Keywords Check (+15)
  for (const action of ACTION_KEYWORDS) {
    if (text.includes(action)) score += 15;
  }

  return score;
}

// Scrape and AI Process Workflow
async function processIpoNews() {
  console.log("🔍 Fetching IPO news from RSS feeds...");

  for (const feedUrl of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedUrl);
      
      for (const item of feed.items) {
        const link = item.link || item.guid;
        if (!link || processedUrls.has(link)) continue;

        const title = item.title || "";
        const snippet = item.contentSnippet || item.content || "";
        const score = calculateScore(title, snippet);

        // Threshold check (Must be >= 35)
        if (score >= 35) {
          console.log(`🎯 Valid News Found (Score: ${score}): ${title}`);
          processedUrls.add(link);

          // Gemini AI Analysis
          const prompt = `
          तपाईं एउटा शेयर बजार विश्लेषक हो। तल दिइएको समाचार शीर्षक र लिङ्कको आधारमा विश्लेषण गर्नुहोस्:
          शीर्षक: ${title}
          विवरण: ${snippet}

          यदि यो समाचार नयाँ IPO/Right Share खुलाएको वा IPO को बाँडफाँड/नतिजा (Result) सम्बन्धी हो भने मात्र JSON ढाँचामा उत्तर दिनुहोस्।
          यदि यो अरू नै समाचार हो भने {"isValid": false} मात्र दिनुहोस्।

          JSON Format Output:
          {
            "isValid": true/false,
            "type": "IPO_ALERT" वा "IPO_RESULT",
            "company_name": "कम्पनीको नाम (अंग्रेजीमा)",
            "title": "युजरका लागि छोटो र आकर्षक शीर्षक",
            "description": "२ लाइनको छोटो विवरण",
            "redirect_target": "WEBVIEW" (यदि IPO_ALERT हो भने) वा "IPO_RESULT_SECTION" (यदि IPO_RESULT हो भने)
          }
          Only return pure JSON.
          `;

          try {
            const response = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt
            });

            const rawText = response.text.replace(/```json|```/g, "").trim();
            const aiResult = JSON.parse(rawText);

            if (aiResult.isValid) {
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

              // Unshift to keep newest first
              ipoNotifications.unshift(newNotification);
              // Limit memory to latest 30 notifications
              if (ipoNotifications.length > 30) ipoNotifications.pop();

              console.log(`✅ New Notification Added: ${newNotification.title}`);
            }
          } catch (aiErr) {
            console.error("Gemini Parsing Error:", aiErr.message);
          }
        }
      }
    } catch (err) {
      console.error(`Error fetching feed from ${feedUrl}:`, err.message);
    }
  }
}

// CRON JOB 1: Run every 30 minutes to scrape new feeds
cron.schedule("*/30 * * * *", () => {
  processIpoNews();
});

// CRON JOB 2: Daily Reminders at 8:00 AM
cron.schedule("0 8 * * *", () => {
  console.log("⏰ Generating Daily Reminder Notifications...");
  ipoNotifications.forEach(item => {
    if (item.type === "IPO_ALERT" && item.is_active) {
      item.title = `भर्नुभयो त ${item.company_name} को IPO?`;
      item.description = "आजै आवेदन दिनुहोस्, अन्तिम मिति नजिकै छ।";
    }
  });
});

// Run once on startup
setTimeout(() => {
  processIpoNews();
}, 5000);

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
