import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { extractTextFromFile } from "../utils/fileParser.js";
import Groq from "groq-sdk";

dotenv.config();
// import { OpenAI } from "openai";

const router = express.Router();
const upload = multer({
    dest: "uploads/",
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// console.log("OpenAI Key Exists:", !!process.env.OPENAI_API_KEY);
console.log("Groq Key Exists:", !!process.env.GROQ_API_KEY);

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

// const openai = new OpenAI({
//     apiKey: process.env.OPENAI_API_KEY,
// });

function extractFirstJsonObject(str) {
    const start = str.indexOf("{");
    const end = str.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
        return str.slice(start, end + 1);
    }
    return null;
}

function isValidFlashcardsShape(data) {
    return (
        data &&
        Array.isArray(data.flashcards) &&
        data.flashcards.length === 10 &&
        data.flashcards.every(
            (fc) =>
                typeof fc.question === "string" && typeof fc.answer === "string"
        )
    );
}

function isValidQuestionsShape(data) {
    return (
        data &&
        Array.isArray(data.questions) &&
        data.questions.length === 10 &&
        data.questions.every(
            (q) =>
                typeof q.question === "string" &&
                Array.isArray(q.choices) &&
                q.choices.length === 4 &&
                Number.isInteger(q.answerIndex) &&
                q.answerIndex >= 0 &&
                q.answerIndex <= 3
        )
    );
}

router.post("/", upload.single("file"), async (req, res) => {
    try {
        const { inputText, type } = req.body;
        let contentToUse = inputText;

        // If a file was uploaded
        if (req.file) {
            const mimetype = req.file.mimetype;
            const filePath = path.resolve(req.file.path);
            contentToUse = await extractTextFromFile(filePath, mimetype);
            await fs.unlink(filePath); // Clean up file after reading
        }

        if (!contentToUse || contentToUse.trim().length < 20) {
            return res
                .status(400)
                .json({ error: "Insufficient input content" });
        }

        const MAX_CHARS = 8000;
        if (contentToUse.length > MAX_CHARS) {
            contentToUse = contentToUse.slice(0, MAX_CHARS);
        }

        const wantFlashcards = type === "flashcards";
        const systemPrompt = wantFlashcards
            ? `You are a flashcard generator. Always return STRICT JSON with this schema:
{
  "flashcards": [
    { "question": "string", "answer": "string" }
  ]
}
Rules:
- Exactly 10 flashcards.
- No markdown, no backticks, no commentary.
- Plain JSON only.`
            : `You are a quiz generator. Always return STRICT JSON with this schema:
{
  "questions": [
    { "question": "string", "choices": ["A","B","C","D"], "answerIndex": 0 }
  ]
}
Rules:
- Exactly 10 multiple-choice questions.
- Each "choices" array must have exactly 4 options.
- "answerIndex" is 0..3 and matches the correct choice.
- No markdown, no backticks, no commentary.
- Plain JSON only.`;

        const userPrompt = wantFlashcards
            ? `Create 10 flashcards from the content:\n\n${contentToUse}`
            : `Create 10 MCQs from the content with 4 options each. Return only JSON:\n\n${contentToUse}`;

        const completion = await groq.chat.completions.create({
            model: "llama3-8b-8192",
            temperature: 0.2,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
        });
        // const completion = await openai.chat.completions.create({
        //     model: "gpt-3.5-turbo",
        //     messages: [{ role: "user", content: prompt }],
        // });

        let text = completion.choices[0].message.content?.trim() || "";

        // Strip code fences if any
        if (text.startsWith("```")) {
            text = text
                .replace(/^```(?:json)?/i, "")
                .replace(/```$/, "")
                .trim();
        }

        let data;
        let jsonCandidate = extractFirstJsonObject(text);

        try {
            data = jsonCandidate ? JSON.parse(jsonCandidate) : JSON.parse(text);
        } catch (e) {
            console.warn(
                "Primary JSON parse failed, attempting one retry with stricter instruction…"
            );

            // ONE lightweight retry that *forces* JSON-only
            const retry = await groq.chat.completions.create({
                model: "llama3-8b-8192",
                temperature: 0.1,
                messages: [
                    {
                        role: "system",
                        content:
                            "Return ONLY valid JSON. No prose. No markdown. Follow the schema exactly.",
                    },
                    { role: "user", content: userPrompt },
                ],
            });

            let retryText = retry.choices[0].message.content?.trim() || "";
            if (retryText.startsWith("```")) {
                retryText = retryText
                    .replace(/^```(?:json)?/i, "")
                    .replace(/```$/, "")
                    .trim();
            }
            const retryJson = extractFirstJsonObject(retryText) || retryText;

            try {
                data = JSON.parse(retryJson);
            } catch (e2) {
                console.error(
                    "JSON parse failed after retry; raw text:",
                    retryText
                );
                return res
                    .status(502)
                    .json({ error: "Model returned invalid JSON" });
            }
        }

        // Minimal shape validation
        if (wantFlashcards) {
            if (!isValidFlashcardsShape(data)) {
                return res
                    .status(502)
                    .json({ error: "Invalid flashcards shape" });
            }
        } else {
            if (!isValidQuestionsShape(data)) {
                return res
                    .status(502)
                    .json({ error: "Invalid questions shape" });
            }
        }

        return res.json({ result: data });
    } catch (error) {
        console.error("Generation error:", error);
        res.status(500).json({ error: "Failed to generate content" });
    }
});

export default router;
