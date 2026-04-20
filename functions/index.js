const fs = require("fs");
const os = require("os");
const path = require("path");
// require("dotenv").config({ path: path.join(__dirname, ".env") });

const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager, FileState } = require("@google/generative-ai/server");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

async function requireAuth(req, res, next) {
  try {
    if (process.env.AUTH_DISABLED === "true") return next();
    const rel = (req.originalUrl && req.originalUrl.split("?")[0]) || "";
    if (req.method === "GET" && (rel === "/api" || rel === "/api/")) return next();
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Sign in required." });
    }
    const token = authHeader.slice(7);
    const decoded = await admin.auth().verifyIdToken(token);
    const email = (decoded.email || "").toLowerCase();
    const allowed = (process.env.ALLOWED_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(email)) {
      return res.status(403).json({ error: "Your account is not authorized for this app." });
    }
    next();
  } catch (e) {
    console.error("requireAuth", e && e.message ? e.message : e);
    return res.status(401).json({ error: "Invalid or expired session. Sign in again." });
  }
}

app.use("/api", requireAuth);

/** Max user/message text per /api/chat request (workflows can embed long {{previous}} / {{all_previous}}). */
const MAX_MESSAGE_LENGTH = 262144;
const MAX_FILES = 8;
const MAX_TOTAL_INLINE_BYTES = 80 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/", "video/", "application/pdf", "text/", "application/json"];

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
});

function validateChatBody(body) {
  if (body.message != null && String(body.message).length > MAX_MESSAGE_LENGTH) return "Message too long.";
  const files = body.files;
  if (Array.isArray(files)) {
    if (files.length > MAX_FILES) return "Too many files.";
    let totalInlineBytes = 0;
    for (const f of files) {
      if (!f || typeof f !== "object") continue;
      const uri = f.fileUri || (f.geminiFile && f.geminiFile.uri);
      if (uri) {
        if (f.mimeType && !ALLOWED_MIME_PREFIXES.some((p) => f.mimeType.startsWith(p) || f.mimeType === p)) {
          return "File type not allowed.";
        }
        continue;
      }
      if (typeof f.data === "string" && f.data.length > 0) {
        if (f.mimeType && !ALLOWED_MIME_PREFIXES.some((p) => f.mimeType.startsWith(p) || f.mimeType === p)) {
          return "File type not allowed.";
        }
        totalInlineBytes += Math.ceil((f.data.length * 3) / 4);
      }
    }
    if (totalInlineBytes > MAX_TOTAL_INLINE_BYTES) {
      return "Total inline attachment size too large. Use large file upload (automatic for big files).";
    }
  }
  return null;
}

function buildPartsFromFiles(message, files) {
  const parts = [];
  if (message && String(message).trim()) parts.push({ text: String(message).trim().slice(0, MAX_MESSAGE_LENGTH) });
  if (files && Array.isArray(files)) {
    for (const file of files) {
      if (!file || typeof file !== "object") continue;
      const mime = typeof file.mimeType === "string" ? file.mimeType : "";
      const uri =
        (typeof file.fileUri === "string" && file.fileUri) ||
        (file.geminiFile && typeof file.geminiFile.uri === "string" ? file.geminiFile.uri : "");
      if (uri && mime) {
        parts.push({ fileData: { fileUri: uri, mimeType: mime } });
        continue;
      }
      const data = typeof file.data === "string" ? file.data : "";
      if (data && mime) parts.push({ inlineData: { mimeType: mime, data } });
    }
  }
  return parts;
}

async function waitForFileActive(fileManager, resourceName, maxMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const meta = await fileManager.getFile(resourceName);
    if (meta.state === FileState.ACTIVE) return meta;
    if (meta.state === FileState.FAILED) {
      throw new Error((meta.error && meta.error.message) || "Uploaded file processing failed.");
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("File processing timed out (very large videos can take several minutes). Try again or trim the clip.");
}

const apiRouter = express.Router();

apiRouter.get("/", (req, res) => {
  res.send("BizBot API is Running! 🤖");
});

apiRouter.post("/upload", upload.single("file"), async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'No file uploaded. Use multipart field name "file".' });
  const mimeType = f.mimetype || "application/octet-stream";
  if (!ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p) || mimeType === p)) {
    try {
      fs.unlinkSync(f.path);
    } catch (_) {}
    return res.status(400).json({ error: "File type not allowed." });
  }
  try {
    const fm = new GoogleAIFileManager(apiKey);
    const uploadRes = await fm.uploadFile(f.path, {
      mimeType,
      displayName: f.originalname || "upload",
    });
    try {
      fs.unlinkSync(f.path);
    } catch (_) {}
    const resourceName = uploadRes.file && uploadRes.file.name;
    if (!resourceName) throw new Error("Upload response missing file name");
    await waitForFileActive(fm, resourceName);
    const meta = await fm.getFile(resourceName);
    return res.json({
      uri: meta.uri,
      mimeType: meta.mimeType,
      resourceName: meta.name,
      displayName: meta.displayName,
    });
  } catch (error) {
    try {
      if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    } catch (_) {}
    console.error("[upload]", error);
    return res.status(500).json({
      error: "Upload failed",
      details: error.message || String(error),
    });
  }
});

async function handleChat(req, res, stream) {
  try {
    const err = validateChatBody(req.body);
    if (err) return res.status(400).json({ error: err });

    const { message, history, systemInstruction, model: modelId, agentId, toolResults } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured." });

    let parts = buildPartsFromFiles(message, req.body.files);
    
    // If toolResults are provided, they take precedence over the message/files
    if (toolResults && toolResults.length > 0) {
      parts = toolResults;
    }
    
    const modelName = modelId || "gemini-2.5-flash";
    const genAI = new GoogleGenerativeAI(apiKey);

    // Tools Configuration: Relay Tools + Neural Memory
    const tools = [
      {
        functionDeclarations: [
          {
            name: "bash",
            description: "Execute a shell command on the local system. Use this to run builds, tests, or system utilities.",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "The shell command to execute." },
                workdir: { type: "string", description: "The working directory (optional)." },
              },
              required: ["command"],
            },
          },
          {
            name: "read_file",
            description: "Read the contents of a file from the local filesystem.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The relative path to the file." },
              },
              required: ["path"],
            },
          },
          {
            name: "write_file",
            description: "Write content to a file on the local filesystem.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The relative path to the file." },
                content: { type: "string", description: "The content to write." },
              },
              required: ["path", "content"],
            },
          },
          {
            name: "edit_file",
            description: "Replace a specific block of text in a file. Use this for precise code edits.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "The relative path to the file." },
                oldString: { type: "string", description: "The exact text to find." },
                newString: { type: "string", description: "The text to replace it with." },
              },
              required: ["path", "oldString", "newString"],
            },
          },
          {
            name: "get_neural_memory",
            description: "Retrieve long-term memory facts from the neural database.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Search query for memory retrieval." },
              },
              required: ["query"],
            },
          },
          {
            name: "update_neural_memory",
            description: "Save a new fact or preference to the long-term neural memory.",
            parameters: {
              type: "object",
              properties: {
                fact: { type: "string", description: "The fact to remember." },
                category: { type: "string", description: "Category (e.g. 'preference', 'shop_detail')." },
              },
              required: ["fact"],
            },
          },
        ],
      },
    ];

    const safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    ];

    const geminiModel = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemInstruction || "You are a helpful business assistant.",
      tools,
      safetySettings,
    });


    // 1. Build initial contents from history
    const contents = (history || []).map((h) => ({
      role: h.role === "assistant" ? "model" : h.role,
      parts: h.parts,
    }));

    // 2. Add current turn: either toolResults or user message
    if (toolResults && toolResults.length > 0) {
      contents.push({ role: "function", parts: toolResults });
    } else {
      const currentParts = buildPartsFromFiles(message, req.body.files);
      if (currentParts.length > 0) {
        contents.push({ role: "user", parts: currentParts });
      }
    }

    if (contents.length === 0) {
      return res.status(400).json({ error: "Message or tool results required." });
    }

    // Robustness: Gemini requires the first message to be 'user'
    while (contents.length > 0 && contents[0].role !== "user") {
      contents.shift();
    }

    const result = await geminiModel.generateContent({ contents });
    let response = await result.response;

    const call = response.functionCalls();
    if (call && call.length > 0) {
      const toolResponses = [];
      let returnToClient = false;

      for (const c of call) {
        if (c.name === "get_neural_memory") {
          const snapshot = await admin.firestore().collection("memory").get();
          const memory = snapshot.docs.map(doc => doc.data().fact).join("\n");
          toolResponses.push({
            functionResponse: {
              name: "get_neural_memory",
              response: { content: memory || "No prior memory found." },
            },
          });
        } else if (c.name === "update_neural_memory") {
          await admin.firestore().collection("memory").add({
            fact: c.args.fact,
            category: c.args.category || "general",
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
          toolResponses.push({
            functionResponse: {
              name: "update_neural_memory",
              response: { content: "Fact saved to neural memory." },
            },
          });
        } else if (["bash", "read_file", "write_file", "edit_file"].includes(c.name)) {
          // These must be executed locally by the client-side bridge.
          returnToClient = true;
        }
      }
      
      if (returnToClient) {
        // Return the function call to the client
        return res.json({ functionCalls: call });
      }

      if (toolResponses.length > 0) {
        const secondContents = [
          ...contents, 
          { role: "model", parts: call.map(c => ({ functionCall: c })) },
          { role: "function", parts: toolResponses }
        ];
        const secondResult = await geminiModel.generateContent({ contents: secondContents });
        response = await secondResult.response;
      }
    }

    let text;
    try {
      text = response.text();
    } catch (textError) {
      const textMsg = textError && textError.message ? textError.message : String(textError);
      if (/blocked|safety|not supported|empty/i.test(textMsg)) {
        return res.status(422).json({ error: "Response was blocked.", details: "Try rephrasing." });
      }
      throw textError;
    }
    const usage = response.usageMetadata || response.usage;
    res.json({ text, usage: usage || undefined });
  } catch (error) {
    console.error("AI Error:", error);
    const payload = { error: "AI failed", details: error.message };
    const isDev = process.env.FUNCTIONS_EMULATOR === "true" || process.env.NODE_ENV === "development";
    if (isDev && error.stack) payload.stack = error.stack;
    res.status(500).json(payload);
  }
}

apiRouter.post("/chat/stream", (req, res) => handleChat(req, res, true));
apiRouter.post("/chat", (req, res) => handleChat(req, res, false));

apiRouter.post("/send-email", async (req, res) => {
  try {
    const { to, subject, text, html } = req.body;
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL } = process.env;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || "587", 10),
      secure: SMTP_PORT === "465",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"BizBot AI" <${FROM_EMAIL || SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Email Error:", error.message);
    res.status(500).json({ error: "Email failed", details: error.message });
  }
});

app.use("/api", apiRouter);

const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");

// Set global options to allow unauthenticated access to the API (required for public chat)
// or we can handle auth inside the app logic as we already do.
setGlobalOptions({ maxInstances: 10 });

exports.bizbot_server = onRequest({
  cors: true,
  invoker: "public"
}, app);
