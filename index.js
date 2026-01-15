import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = "./cache.json";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// ---------- Cache ----------
function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
}

function saveCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

// ---------- Horoscope Generator ----------
async function generateHoroscope() {
  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-70b-versatile",
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content: "Generate calm, neutral daily horoscope in English. Avoid dramatic tone. Output JSON only."
          },
          {
            role: "user",
            content: "Generate today's horoscope for all 12 zodiac signs."
          }
        ]
      })
    }
  );

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

// ---------- API ----------
app.get("/horoscope", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const cache = loadCache();

    if (cache && cache.date === today) {
      return res.json(cache.data);
    }

    const horoscope = await generateHoroscope();

    const finalData = {
      date_np: "१ माघ २०८२, बिहिवार",
      source: "Groq AI (Hamro Patro)",
      generated_at: new Date().toISOString(),
      last_checked: new Date().toLocaleString(),
      data: horoscope.data
    };

    saveCache({ date: today, data: finalData });
    res.json(finalData);

  } catch (err) {
    res.status(502).json({ error: "Service unavailable" });
  }
});

// ---------- Health Check ----------
app.get("/", (req, res) => {
  res.send("Horoscope API running");
});

app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});
