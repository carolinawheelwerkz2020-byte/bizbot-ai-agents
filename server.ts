import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import admin from "firebase-admin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, ".env.local"), override: true });

type RequestHistoryEntry = {
  role?: string;
  parts?: Part[];
};

type RequestFile = {
  mimeType: string;
  data?: string;
  geminiFile?: {
    uri: string;
    mimeType?: string;
  };
};

function normalizeRole(role?: string): "user" | "model" | "function" {
  if (role === "model" || role === "function") return role;
  return "user";
}

function createGeminiClients() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY or GOOGLE_API_KEY.");
  }

  return {
    genAI: new GoogleGenerativeAI(apiKey),
    fileManager: new GoogleAIFileManager(apiKey),
  };
}

function buildUserParts(message: string, files: RequestFile[] = [], toolResults: unknown[] = []): Part[] {
  const parts: Part[] = [];

  if (message?.trim()) {
    parts.push({ text: message.trim() });
  }

  for (const file of files) {
    if (file.geminiFile?.uri) {
      parts.push({
        fileData: {
          fileUri: file.geminiFile.uri,
          mimeType: file.geminiFile.mimeType || file.mimeType,
        },
      });
      continue;
    }

    if (file.data) {
      parts.push({
        inlineData: {
          data: file.data,
          mimeType: file.mimeType,
        },
      });
    }
  }

  for (const toolResult of toolResults) {
    parts.push(toolResult as Part);
  }

  return parts;
}

async function startServer() {
  console.log("Starting Aegis Command Center (Node API)...");
  const app = express();
  const PORT = 3000;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // --- Relay Tool Endpoints ---

  /** Execute a shell command. */
  app.post("/api/relay/exec", async (req, res) => {
    const { command, workdir } = req.body;
    if (!command) return res.status(400).json({ error: "No command provided." });

    const { exec } = await import("child_process");
    exec(command, { cwd: workdir || process.cwd() }, (error, stdout, stderr) => {
      res.json({
        stdout: stdout || "",
        stderr: stderr || "",
        exitCode: error ? error.code : 0,
      });
    });
  });

  /** Read a file. */
  app.get("/api/relay/read", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "No path provided." });
    try {
      const content = fs.readFileSync(path.resolve(filePath), "utf8");
      res.json({ content });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown read error.";
      res.status(500).json({ error: message });
    }
  });

  /** Write a file. */
  app.post("/api/relay/write", (req, res) => {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: "Missing path or content." });
    try {
      fs.writeFileSync(path.resolve(filePath), content, "utf8");
      res.json({ success: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown write error.";
      res.status(500).json({ error: message });
    }
  });

  /** Edit a file (Search & Replace). */
  app.post("/api/relay/edit", (req, res) => {
    const { path: filePath, oldString, newString } = req.body;
    if (!filePath || !oldString || newString === undefined) return res.status(400).json({ error: "Missing required fields." });
    try {
      const fullPath = path.resolve(filePath);
      let content = fs.readFileSync(fullPath, "utf8");
      if (!content.includes(oldString)) {
        return res.status(400).json({ error: "oldString not found in file." });
      }
      content = content.replace(oldString, newString);
      fs.writeFileSync(fullPath, content, "utf8");
      res.json({ success: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown edit error.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const {
        message = "",
        history = [],
        systemInstruction = "",
        files = [],
        toolResults = [],
      } = req.body as {
        message?: string;
        history?: RequestHistoryEntry[];
        systemInstruction?: string;
        files?: RequestFile[];
        toolResults?: unknown[];
      };

      const { genAI } = createGeminiClients();
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        systemInstruction,
      });

      const userParts = buildUserParts(message, files, toolResults);
      if (userParts.length === 0) {
        return res.status(400).json({ error: "No message, files, or tool results were provided." });
      }

      const result = await model.generateContent({
        contents: [
          ...history.map((entry) => ({
            role: normalizeRole(entry.role),
            parts: entry.parts || [],
          })),
          {
            role: "user",
            parts: userParts,
          },
        ],
      });

      const response = result.response;
      const functionCalls = typeof response.functionCalls === "function" ? response.functionCalls() : undefined;

      res.json({
        text: response.text(),
        functionCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown chat error.";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-upload-"));
    const tempPath = path.join(tempDir, req.file.originalname);

    try {
      const { fileManager } = createGeminiClients();
      fs.writeFileSync(tempPath, req.file.buffer);

      const uploadResult = await fileManager.uploadFile(tempPath, {
        mimeType: req.file.mimetype,
        displayName: req.file.originalname,
      });

      let uploadedFile = uploadResult.file;
      const resourceName = uploadedFile.name;

      if (uploadedFile.state === FileState.PROCESSING && resourceName) {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          uploadedFile = await fileManager.getFile(resourceName);
          if (uploadedFile.state !== FileState.PROCESSING) break;
        }
      }

      if (uploadedFile.state !== FileState.ACTIVE) {
        return res.status(500).json({
          error: `Uploaded file did not become active. Current state: ${uploadedFile.state || "unknown"}`,
        });
      }

      res.json({
        uri: uploadedFile.uri,
        mimeType: uploadedFile.mimeType || req.file.mimetype,
        resourceName: uploadedFile.name,
        displayName: uploadedFile.displayName || req.file.originalname,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown upload error.";
      res.status(500).json({ error: message });
    } finally {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      console.log("Vite middleware applied.");
    } catch (e) {
      console.warn("Could not start Vite dev middleware (Rollup/Native module issue). Serving dist/ only.");
      process.env.NODE_ENV = "production";
    }
  }

  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    if (!fs.existsSync(distPath)) {
      console.error("[config] dist/ not found. Run `npm run build` or ensure build artifacts are present.");
    }
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
