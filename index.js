async function processAndGenerate(
  rawContent,
  dateEn,
  dayName,
  dateNp,
  sourceUsed
) {
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      "❌ ERROR: GEMINI_API_KEY is missing in environment variables!"
    );

    return false;
  }

  let statusMessage =
    sourceUsed !== "None" ? "" : "Loading...";

  try {
    // ==========================================================
    // STEP 1 — SOURCE NEPALI → ENGLISH
    // ==========================================================

    console.log(
      `🌐 Step 1: ${sourceUsed} को raw horoscope लाई English मा translate गर्दै...`
    );

    const translationPrompt = `
You are a professional translator.

Translate the following scraped Nepali horoscope content into clear,
accurate English.

IMPORTANT:
- Translate the meaning faithfully.
- Do NOT summarize.
- Do NOT add information.
- Do NOT remove important information.
- Preserve the meaning of each zodiac sign.
- This English translation is an intermediate representation only.
- Do not write a new horoscope at this stage.

RAW NEPALI HOROSCOPE:
${rawContent ? rawContent.substring(0, 8000) : "Daily Horoscope"}

Return ONLY the English translation.
Do not add explanations, headings, markdown, or comments.
`;

    const englishSource = await callGeminiAI(
      translationPrompt
    );

    if (!englishSource || englishSource.trim().length < 100) {
      throw new Error(
        "English intermediate translation was empty or too short."
      );
    }

    console.log(
      "✅ Step 1 complete: English intermediate data तयार भयो।"
    );

    // ==========================================================
    // STEP 2 — ENGLISH MEANING → COMPLETELY FRESH NEPALI
    // ==========================================================

    console.log(
      "🧠 Step 2: English meaning बाट completely fresh Nepali Rashifal तयार गर्दै..."
    );

    const generationPrompt = `
You are an original Nepali horoscope content writer.

You have been given an ENGLISH INTERMEDIATE TRANSLATION of horoscope
information from another source.

Your job is NOT to translate the source sentence-by-sentence.

Instead, understand the general astrological themes and create a
COMPLETELY FRESH, ORIGINAL Nepali horoscope for each zodiac sign.

IMPORTANT ORIGINALITY RULES:

1. Do NOT copy or closely rewrite any sentence from the source.
2. Do NOT preserve the source sentence order.
3. Do NOT preserve the source wording or phrasing.
4. Do NOT translate the English sentences directly into Nepali.
5. Do NOT imitate the source's writing style.
6. Rearrange the ideas naturally.
7. Express the same general astrological themes using completely
   different Nepali wording and sentence construction.
8. Do not create detailed events that are not supported by the
   general astrological themes.
9. The final Nepali text must read like independently written
   horoscope content.
10. Never mention the source, HamroPatro, NepaliPatro, translation,
    English text, or AI.

STYLE:
- Simple, natural, conversational Nepali.
- Easy for ordinary Nepali readers to understand.
- Avoid heavy Sanskrit/official vocabulary.
- Each zodiac sign must have EXACTLY 4 sentences.
- Keep each prediction concise.
- Never put the zodiac sign name inside its prediction.
- Do not start sentences with "आजको दिन" or "यस दिन".
- Do not include lucky color, lucky number, lucky direction,
  gemstone, or similar details unless specifically required.
- Avoid repetitive sentence patterns between zodiac signs.

DATE:
Use exactly this date:
"${dateNp}"

ENGLISH INTERMEDIATE SOURCE:
${englishSource.substring(0, 12000)}

Return ONLY valid JSON using exactly this structure:

{
  "date_np": "${dateNp}",
  "date": "${dateEn}",
  "day": "${dayName}",
  "status_message": "${statusMessage}",
  "data": [
    {"sign": "Aries", "sign_np": "मेष", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Taurus", "sign_np": "वृष", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Gemini", "sign_np": "मिथुन", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Cancer", "sign_np": "कर्कट", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Leo", "sign_np": "सिंह", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Virgo", "sign_np": "कन्या", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Libra", "sign_np": "तुला", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Scorpio", "sign_np": "वृश्चिक", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Sagittarius", "sign_np": "धनु", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Capricorn", "sign_np": "मकर", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Aquarius", "sign_np": "कुम्भ", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"},
    {"sign": "Pisces", "sign_np": "मीन", "prediction": "चारवटा नयाँ र मौलिक वाक्य।"}
  ]
}

CRITICAL:
Return ONLY the JSON object.
No markdown.
No explanation.
No source text.
`;

    const content = await callGeminiAI(
      generationPrompt
    );

    const cleanJson = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const generatedData = JSON.parse(cleanJson);

    // ==========================================================
    // BASIC VALIDATION
    // ==========================================================

    if (
      !generatedData ||
      generatedData.date !== dateEn ||
      !Array.isArray(generatedData.data) ||
      generatedData.data.length !== 12
    ) {
      throw new Error(
        "Gemini returned invalid Rashifal structure."
      );
    }

    cache = {
      data: generatedData,
      last_updated: new Date().toISOString()
    };

    console.log(
      "✅ Success! English intermediate translation हुँदै completely fresh Nepali Rashifal तयार भयो र cache update भयो।"
    );

    return true;

  } catch (err) {
    console.error(
      "❌ Gemini AI Processing Failed:",
      err.message
    );

    return false;
  }
}
