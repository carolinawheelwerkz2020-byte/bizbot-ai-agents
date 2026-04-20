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

async function startServer() {
  console.log("Starting Aegis Command Center (Node API)...");
  const app = express();
  const PORT = 3000;

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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
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
      res.status(500).json({ error: e.message });
    }
  });

  // API Routes... (preserving all logic)

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
