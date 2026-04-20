import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "path";
import { execFile, spawn } from "node:child_process";
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

type UploadedFile = {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
};

type ToolCall = {
  name: string;
  args?: Record<string, unknown>;
};

const MAX_MESSAGE_LENGTH = 262_144;
const MAX_FILES = 8;
const MAX_TOTAL_INLINE_BYTES = 80 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/", "video/", "application/pdf", "text/", "application/json"];
const AUTH_DISABLED = process.env.AUTH_DISABLED === "true";
const RELAY_ALLOWED_COMMANDS = new Set([
  "npm",
  "npx",
  "node",
  "git",
  "tsx",
  "tsc",
  "vite",
]);
const RELAY_ALLOWED_ROOTS = [
  path.resolve(process.env.RELAY_ROOT || process.cwd()),
];
const MEMORY_STORE_PATH = path.join(process.cwd(), ".bizbot-memory.json");
const MAX_FETCHED_PAGE_CHARS = 12_000;

function ensureFirebaseAdmin() {
  if (admin.apps.length > 0) return;
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

function getAllowedEmails() {
  return (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getBearerToken(header?: string) {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

async function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (AUTH_DISABLED) {
    return next();
  }

  try {
    ensureFirebaseAdmin();
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Sign in required." });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const email = (decoded.email || "").toLowerCase();
    const allowedEmails = getAllowedEmails();

    if (allowedEmails.length > 0 && !allowedEmails.includes(email)) {
      return res.status(403).json({ error: "Your account is not authorized for this app." });
    }

    return next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown auth error.";
    console.error("[auth]", message);
    return res.status(401).json({ error: "Invalid or expired session. Sign in again." });
  }
}

function isPathInsideRoot(targetPath: string, rootPath: string) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveRelayPath(inputPath: string) {
  const resolvedPath = path.resolve(inputPath);
  const isAllowed = RELAY_ALLOWED_ROOTS.some((root) => isPathInsideRoot(resolvedPath, root));
  if (!isAllowed) {
    throw new Error("Requested path is outside the allowed relay workspace.");
  }
  return resolvedPath;
}

function tokenizeCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("No command provided.");
  }

  if (/[|&;><`]/.test(trimmed)) {
    throw new Error("Shell operators are not allowed in relay commands.");
  }

  return trimmed.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
}

function validateRelayCommand(command: string) {
  const parts = tokenizeCommand(command);
  const executable = parts[0]?.toLowerCase();
  if (!executable || !RELAY_ALLOWED_COMMANDS.has(executable)) {
    throw new Error(`Command "${parts[0] || ""}" is not allowed by the relay policy.`);
  }
  return {
    executable: parts[0],
    args: parts.slice(1),
  };
}

function isAllowedMimeType(mimeType?: string) {
  if (!mimeType) return false;
  return ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix) || mimeType === prefix);
}

function estimateBase64Bytes(data: string) {
  return Math.ceil((data.length * 3) / 4);
}

function validateChatBody(body: {
  message?: unknown;
  files?: RequestFile[];
  history?: RequestHistoryEntry[];
  toolResults?: unknown[];
}) {
  if (body.message != null && String(body.message).length > MAX_MESSAGE_LENGTH) {
    return "Message too long.";
  }

  if (Array.isArray(body.history) && body.history.length > 200) {
    return "History is too long.";
  }

  if (Array.isArray(body.toolResults) && body.toolResults.length > 50) {
    return "Too many tool results were provided.";
  }

  if (Array.isArray(body.files)) {
    if (body.files.length > MAX_FILES) {
      return "Too many files.";
    }

    let totalInlineBytes = 0;

    for (const file of body.files) {
      if (!file || typeof file !== "object") continue;
      const mimeType = file.geminiFile?.mimeType || file.mimeType;

      if (mimeType && !isAllowedMimeType(mimeType)) {
        return "File type not allowed.";
      }

      if (file.data) {
        totalInlineBytes += estimateBase64Bytes(file.data);
      }
    }

    if (totalInlineBytes > MAX_TOTAL_INLINE_BYTES) {
      return "Total inline attachment size too large. Use uploaded files for large attachments.";
    }
  }

  return null;
}

function getModelTools(): any[] {
  return [
    {
      functionDeclarations: [
        {
          name: "bash",
          description: "Execute an allowed workspace command on the local system.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "The command to execute." },
              workdir: { type: "string", description: "Optional working directory inside the relay workspace." },
            },
            required: ["command"],
          },
        },
        {
          name: "read_file",
          description: "Read a file from the allowed workspace.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file inside the relay workspace." },
            },
            required: ["path"],
          },
        },
        {
          name: "write_file",
          description: "Write a file inside the allowed workspace.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file inside the relay workspace." },
              content: { type: "string", description: "The full content to write." },
            },
            required: ["path", "content"],
          },
        },
        {
          name: "edit_file",
          description: "Replace a specific block of text in a file inside the allowed workspace.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file inside the relay workspace." },
              oldString: { type: "string", description: "The exact text to find." },
              newString: { type: "string", description: "The replacement text." },
            },
            required: ["path", "oldString", "newString"],
          },
        },
        {
          name: "get_neural_memory",
          description: "Retrieve durable business or project facts from neural memory.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Query used to retrieve relevant stored facts." },
            },
            required: ["query"],
          },
        },
        {
          name: "update_neural_memory",
          description: "Save a durable fact, preference, or operating detail to neural memory.",
          parameters: {
            type: "object",
            properties: {
              fact: { type: "string", description: "The fact to remember." },
              category: { type: "string", description: "Optional category like preference, shop_detail, or technical_note." },
            },
            required: ["fact"],
          },
        },
        {
          name: "route_to_agent",
          description: "Hand work off to another BizBot agent so execution can continue with the best specialist.",
          parameters: {
            type: "object",
            properties: {
              agentId: { type: "string", description: "The target BizBot agent id." },
              prompt: { type: "string", description: "The exact prompt or task brief for the target agent." },
              reason: { type: "string", description: "Short explanation for why the handoff is happening." },
            },
            required: ["agentId", "prompt"],
          },
        },
        {
          name: "open_browser",
          description: "Open a URL in the user's default browser.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The http or https URL to open." },
            },
            required: ["url"],
          },
        },
        {
          name: "fetch_url",
          description: "Fetch and read page content from a URL so the agent can inspect a webpage.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "The http or https URL to fetch." },
            },
            required: ["url"],
          },
        },
      ],
    },
  ];
}

function parseHttpUrl(input: string) {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("A valid http or https URL is required.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  return parsed;
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function openBrowserUrl(url: string) {
  const safeUrl = parseHttpUrl(url).toString();

  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", safeUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return `Opened ${safeUrl} in the default browser.`;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [safeUrl], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return `Opened ${safeUrl} in the default browser.`;
  }

  const child = spawn("xdg-open", [safeUrl], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return `Opened ${safeUrl} in the default browser.`;
}

async function fetchUrlContent(url: string) {
  const safeUrl = parseHttpUrl(url).toString();
  const response = await fetch(safeUrl, {
    headers: {
      "User-Agent": "BizBot-Agent/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  const normalized = contentType.includes("html") ? htmlToText(raw) : raw.trim();

  return {
    url: safeUrl,
    contentType,
    content: normalized.slice(0, MAX_FETCHED_PAGE_CHARS),
  };
}

function readLocalMemoryStore() {
  if (!fs.existsSync(MEMORY_STORE_PATH)) {
    return [] as Array<{ fact: string; category: string; timestamp: string }>;
  }

  try {
    const raw = fs.readFileSync(MEMORY_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Array<{ fact?: string; category?: string; timestamp?: string }>;
    return parsed
      .filter((entry) => typeof entry.fact === "string" && entry.fact.trim().length > 0)
      .map((entry) => ({
        fact: entry.fact!.trim(),
        category: entry.category || "general",
        timestamp: entry.timestamp || new Date(0).toISOString(),
      }));
  } catch {
    return [];
  }
}

function writeLocalMemoryStore(entries: Array<{ fact: string; category: string; timestamp: string }>) {
  fs.writeFileSync(MEMORY_STORE_PATH, JSON.stringify(entries, null, 2), "utf8");
}

async function readNeuralMemory(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const localEntries = readLocalMemoryStore();
  const filtered = normalizedQuery
    ? localEntries.filter((entry) => {
        const haystack = `${entry.category} ${entry.fact}`.toLowerCase();
        return normalizedQuery.split(/\s+/).every((token) => haystack.includes(token));
      })
    : localEntries;

  const relevant = (filtered.length > 0 ? filtered : localEntries).slice(-12);
  if (relevant.length === 0) {
    return "No prior neural memory found.";
  }

  return relevant
    .map((entry) => `[${entry.category}] ${entry.fact}`)
    .join("\n");
}

async function writeNeuralMemory(fact: string, category?: string) {
  const entry = {
    fact: fact.trim(),
    category: (category || "general").trim() || "general",
    timestamp: new Date().toISOString(),
  };

  const localEntries = readLocalMemoryStore();
  localEntries.push(entry);
  writeLocalMemoryStore(localEntries);
  return "Fact saved to neural memory.";
}

async function resolveServerToolCall(call: ToolCall) {
  if (call.name === "get_neural_memory") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "get_neural_memory",
          response: { content: await readNeuralMemory(String(call.args?.query || "")) },
        },
      },
    };
  }

  if (call.name === "update_neural_memory") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "update_neural_memory",
          response: { content: await writeNeuralMemory(String(call.args?.fact || ""), typeof call.args?.category === "string" ? call.args.category : undefined) },
        },
      },
    };
  }

  if (call.name === "open_browser") {
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "open_browser",
          response: { content: await openBrowserUrl(String(call.args?.url || "")) },
        },
      },
    };
  }

  if (call.name === "fetch_url") {
    const page = await fetchUrlContent(String(call.args?.url || ""));
    return {
      handled: true,
      response: {
        functionResponse: {
          name: "fetch_url",
          response: page,
        },
      },
    };
  }

  return { handled: false as const };
}

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
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_MAX_BYTES } });

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));
  app.use("/api", requireAuth);

  // --- Relay Tool Endpoints ---

  /** Execute a shell command. */
  app.post("/api/relay/exec", async (req, res) => {
    const { command, workdir } = req.body;
    try {
      const { executable, args } = validateRelayCommand(String(command || ""));
      const cwd = resolveRelayPath(typeof workdir === "string" && workdir.trim() ? workdir : process.cwd());

      execFile(executable, args, { cwd, timeout: 60_000 }, (error, stdout, stderr) => {
        res.json({
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: typeof error?.code === "number" ? error.code : 0,
          signal: error?.signal || null,
        });
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown exec error.";
      res.status(400).json({ error: message });
    }
  });

  /** Read a file. */
  app.get("/api/relay/read", (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: "No path provided." });
    try {
      const content = fs.readFileSync(resolveRelayPath(filePath), "utf8");
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
      fs.writeFileSync(resolveRelayPath(String(filePath)), String(content), "utf8");
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
      const fullPath = resolveRelayPath(String(filePath));
      let content = fs.readFileSync(fullPath, "utf8");
      if (!content.includes(oldString)) {
        return res.status(400).json({ error: "oldString not found in file." });
      }
      content = content.replace(String(oldString), String(newString));
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

      const validationError = validateChatBody({ message, history, files, toolResults });
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const { genAI } = createGeminiClients();
      const model = genAI.getGenerativeModel({
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        systemInstruction,
        tools: getModelTools(),
      });

      const userParts = buildUserParts(message, files, toolResults);
      if (userParts.length === 0) {
        return res.status(400).json({ error: "No message, files, or tool results were provided." });
      }

      const contents = [
        ...history.map((entry) => ({
          role: normalizeRole(entry.role),
          parts: entry.parts || [],
        })),
        {
          role: "user" as const,
          parts: userParts,
        },
      ];

      let response = (await model.generateContent({ contents })).response;
      const initialFunctionCalls = typeof response.functionCalls === "function" ? (response.functionCalls() as ToolCall[] | undefined) : undefined;

      if (initialFunctionCalls && initialFunctionCalls.length > 0) {
        const serverToolResponses: Array<{ functionResponse: { name: string; response: { content: string } } }> = [];
        const clientToolCalls: ToolCall[] = [];

        for (const call of initialFunctionCalls) {
          const resolution = await resolveServerToolCall(call);
          if (resolution.handled) {
            serverToolResponses.push(resolution.response);
          } else {
            clientToolCalls.push(call);
          }
        }

        if (clientToolCalls.length > 0) {
          return res.json({ functionCalls: clientToolCalls });
        }

        if (serverToolResponses.length > 0) {
          const secondResponse = await model.generateContent({
            contents: [
              ...contents,
              { role: "model", parts: initialFunctionCalls.map((call) => ({ functionCall: call })) },
              { role: "function", parts: serverToolResponses },
            ],
          } as any);
          response = secondResponse.response;
        }
      }

      const functionCalls = typeof response.functionCalls === "function" ? (response.functionCalls() as ToolCall[] | undefined) : undefined;

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
    const uploadedBinary = (req as typeof req & { file?: UploadedFile }).file;

    if (!uploadedBinary) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    if (!isAllowedMimeType(uploadedBinary.mimetype)) {
      return res.status(400).json({ error: "File type not allowed." });
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bizbot-upload-"));
    const tempPath = path.join(tempDir, uploadedBinary.originalname);

    try {
      const { fileManager } = createGeminiClients();
      fs.writeFileSync(tempPath, uploadedBinary.buffer);

      const uploadResult = await fileManager.uploadFile(tempPath, {
        mimeType: uploadedBinary.mimetype,
        displayName: uploadedBinary.originalname,
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
        mimeType: uploadedFile.mimeType || uploadedBinary.mimetype,
        resourceName: uploadedFile.name,
        displayName: uploadedFile.displayName || uploadedBinary.originalname,
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
