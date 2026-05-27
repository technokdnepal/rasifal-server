const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// यहाँ Key को नाम सही छ
const OR_KEY = process.env.OPENROUTER_API_KEY; 

async function generateRasifal() {
  if (!OR_KEY) {
    console.error("❌ ERROR: OPENROUTER_API_KEY is missing in Environment Variables!");
    return;
  }

  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-oss-120b:free",
        messages: [{ role: "user", content: "१२ राशिको नेपालीमा राशिफल दिनुहोस् (JSON format)" }]
      },
      { 
        headers: { 
          "Authorization": `Bearer ${OR_KEY}`,
          "HTTP-Referer": "https://render.com",
          "X-Title": "Rashifal App"
        } 
      }
    );
    console.log("✅ Success!");
  } catch (err) {
    console.error("❌ OpenRouter Error:", err.response ? err.response.data : err.message);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Running on ${PORT}`);
  generateRasifal();
});
