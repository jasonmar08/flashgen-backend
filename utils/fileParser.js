// import fs from "fs/promises";
// import mammoth from "mammoth";
// import pdfParse from "pdf-parse";

// export async function extractTextFromFile(filePath, mimetype) {
//     const buffer = await fs.readFile(filePath);

//     if (mimetype === "application/pdf") {
//         const data = await pdfParse(buffer);
//         return data.text;
//     }

//     if (
//         mimetype ===
//             "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
//         mimetype === "application/msword"
//     ) {
//         const { value } = await mammoth.extractRawText({ buffer });
//         return value;
//     }

//     throw new Error("Unsupported file type");
// }

import * as fs from "fs/promises";
import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js"; // Legacy build import
import mammoth from "mammoth";

export async function extractTextFromFile(filePath, mimetype) {
    const buffer = await fs.readFile(filePath);

    if (mimetype === "application/pdf") {
        // Disable Web Workers for Node.js
        pdfjsLib.GlobalWorkerOptions.workerSrc = ""; // Disable workers

        const loadingTask = pdfjsLib.getDocument({ data: buffer });
        const pdf = await loadingTask.promise;

        let text = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const strings = content.items.map((item) => item.str);
            text += strings.join(" ") + "\n";
        }

        return text;
    }

    if (
        mimetype ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mimetype === "application/msword"
    ) {
        const { value } = await mammoth.extractRawText({ buffer });
        return value;
    }

    throw new Error("Unsupported file type");
}
