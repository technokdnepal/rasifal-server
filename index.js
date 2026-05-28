const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let cache = { data: [], last_updated: null };

async function generateRasifal() {
  const OR_KEY = process.env.OPENROUTER_API_KEY;
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing!");
    return;
  }

  try {
    console.log("🔄 Generating Rashifal from OpenRouter...");
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-120b:free",
        messages: [{ 
          role: "user", 
          content: "आजको १२ राशिको राशिफल नेपालीमा दिनुहोस्। उत्तर अनिवार्य रूपमा निम्न JSON ढाँचामा मात्र हुनुपर्छ: { \"data\": [{\"sign_np\": \"मेष\", \"prediction\": \"...\"}, ...] }" 
        }]
      },
      { 
        headers: { 
          "Authorization": `Bearer ${OR_KEY.trim()}`, // .trim() ले अनावश्यक स्पेस हटाउँछ
          "HTTP-Referer": "https://render.com",
          "X-Title": "Rashifal App"
        } 
      }
    );

    const content = response.data.choices[0].message.content;
    const parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, ""));
    
    cache = { data: parsed.data, last_updated: new Date().toISOString() };
    console.log("✅ Success! Data cached.");
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.response ? err.response.data : err.message);
  }
}

app.get("/api/rasifal", (req, res) => res.json(cache));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  generateRasifal();
});
