import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import generateRoute from "./routes/generate.js";

dotenv.config();

const app = express();
app.use(cors({ origin: ["http://localhost:5173"] }));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

app.use("/generate", generateRoute);

app.get("/", (req, res) => {
    res.send("Flashgen backend running!");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
