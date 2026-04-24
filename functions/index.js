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

const APPROVAL_POLICY = {
  register_tool: { requestRole: "operator", approveRole: "approver" },
  install_npm_package: { requestRole: "approver", approveRole: "admin" },
  save_healing_recipe: { requestRole: "operator", approveRole: "approver" },
  run_healing_recipe: { requestRole: "operator", approveRole: "approver" },
  self_heal_project: { requestRole: "approver", approveRole: "admin" },
};

const CLOUD_LIMITATION_MESSAGE =
  "This feature is only available in the desktop/local runtime. The Firebase-hosted app supports chat, uploads, and cloud-safe history, but not local shell, file editing, package install, or Playwright browser control.";

function getGmailScannerSetupSteps() {
  return [
    "Create or choose a Google Cloud OAuth client for the Gmail account that receives Carolina Wheel Werkz leads.",
    "Enable the Gmail API in that Google Cloud project.",
    "Generate a refresh token with read-only Gmail scope.",
    "Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in the Firebase function environment.",
    "Redeploy or restart the BizBot API, then run the scanner from Auxiliary.",
  ];
}

function getGmailScannerStatus() {
  const configured = Boolean(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
  return {
    configured,
    authMode: configured ? "oauth-refresh-token" : "not-configured",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    recentRuns: [],
    setupSteps: configured ? [] : getGmailScannerSetupSteps(),
  };
}

function getHeaderValue(headers, headerName) {
  const target = String(headerName).toLowerCase();
  const found = (headers || []).find((header) => String(header.name || "").toLowerCase() === target);
  return found && found.value ? String(found.value) : "";
}

function parseSender(value) {
  const emailMatch = String(value || "").match(/<([^>]+)>/) || String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch ? String(emailMatch[1] || emailMatch[0]).trim() : "";
  const name = String(value || "").replace(/<[^>]+>/g, "").replace(/"/g, "").trim() || email;
  return { name, email };
}

function payloadHasAttachment(payload) {
  if (!payload) return false;
  if (payload.filename) return true;
  if (Array.isArray(payload.parts)) return payload.parts.some((part) => payloadHasAttachment(part));
  return false;
}

function inferRequestedService(text) {
  const normalized = String(text || "").toLowerCase();
  if (normalized.includes("powder")) return "Powder coating";
  if (normalized.includes("curb rash") || normalized.includes("scratch") || normalized.includes("scuff")) return "Curb rash / cosmetic wheel repair";
  if (normalized.includes("bent") || normalized.includes("bend") || normalized.includes("vibration")) return "Bent wheel straightening";
  if (normalized.includes("crack")) return "Cracked wheel repair";
  if (normalized.includes("rim") || normalized.includes("wheel")) return "Wheel repair estimate";
  return "Estimate request";
}

function buildEstimateLeadCandidate(input) {
  const text = `${input.subject} ${input.snippet}`.toLowerCase();
  const requestedService = inferRequestedService(text);
  const missingInfo = [];
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(input.snippet);
  const hasVehicle = /\b(19|20)\d{2}\b/.test(input.snippet) || /\b(honda|toyota|ford|chevy|bmw|mercedes|audi|tesla|lexus|nissan|jeep|dodge|ram|kia|hyundai)\b/i.test(input.snippet);
  if (!hasPhone) missingInfo.push("phone number");
  if (!hasVehicle) missingInfo.push("vehicle year/make/model");
  if (!input.photosAttached && !text.includes("photo") && !text.includes("picture")) missingInfo.push("wheel photos");

  const hotWords = ["estimate", "quote", "pricing", "price", "cost", "appointment", "schedule", "today", "asap", "urgent"];
  const score = hotWords.reduce((total, word) => total + (text.includes(word) ? 1 : 0), 0);
  const status = score >= 2 ? "hot_estimate_lead" : score === 1 ? "needs_reply" : "low_confidence";
  const urgency = text.includes("asap") || text.includes("urgent") || text.includes("today") ? "high" : status === "hot_estimate_lead" ? "normal" : "low";
  const parsedSender = parseSender(input.sender);
  const recommendedNextAction = missingInfo.length > 0
    ? `Reply and ask for ${missingInfo.join(", ")}.`
    : "Reply with estimate next steps and offer scheduling.";

  return {
    ...input,
    status,
    requestedService,
    missingInfo,
    urgency,
    recommendedNextAction,
    dashboardFields: {
      customerName: parsedSender.name,
      email: parsedSender.email,
      phone: hasPhone ? "Found in email body/snippet" : undefined,
      vehicle: hasVehicle ? "Found in email body/snippet" : undefined,
      wheelIssue: requestedService,
      serviceRequested: requestedService,
      photosAttached: input.photosAttached,
      status: status === "hot_estimate_lead" ? "Needs Estimate" : "Needs Review",
      recommendedFollowUp: recommendedNextAction,
    },
    draftReply: [
      `Hi ${parsedSender.name && parsedSender.name !== parsedSender.email ? parsedSender.name.split(/\s+/)[0] : "there"},`,
      "",
      `Thanks for reaching out to Carolina Wheel Werkz. We can help with ${requestedService.toLowerCase()}.`,
      missingInfo.length > 0
        ? `Can you send ${missingInfo.join(", ")} so we can give you the most accurate estimate?`
        : "Send over any additional photos if you have them, and we can help confirm pricing and scheduling.",
      "",
      "Thank you,",
      "Carolina Wheel Werkz",
    ].join("\n"),
  };
}

async function getGmailAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID || "",
      client_secret: process.env.GMAIL_CLIENT_SECRET || "",
      refresh_token: process.env.GMAIL_REFRESH_TOKEN || "",
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Unable to refresh Gmail access token.");
  }
  return payload.access_token;
}

async function runEstimateLeadScan(options = {}) {
  const status = getGmailScannerStatus();
  const lookbackDays = Math.max(1, Math.min(14, Number(options.lookbackDays || 2)));
  const maxResults = Math.max(1, Math.min(50, Number(options.maxResults || 20)));
  const query = `newer_than:${lookbackDays}d (estimate OR quote OR pricing OR price OR cost OR repair OR wheel OR rim OR "powder coating" OR "curb rash" OR appointment)`;
  const ranAt = new Date().toISOString();
  const id = `estimate-scan-${Date.now()}`;

  if (!status.configured) {
    return {
      id,
      ranAt,
      configured: false,
      authMode: "not-configured",
      query,
      lookbackDays,
      leads: [],
      summary: "Gmail scanner is not connected yet. Add OAuth credentials to enable inbox scanning.",
      setupSteps: status.setupSteps,
    };
  }

  const accessToken = await getGmailAccessToken();
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", query);
  listUrl.searchParams.set("maxResults", String(maxResults));
  const listResponse = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listPayload = await listResponse.json().catch(() => ({}));
  if (!listResponse.ok) {
    throw new Error(listPayload.error && listPayload.error.message ? listPayload.error.message : "Unable to search Gmail.");
  }

  const leads = [];
  for (const item of listPayload.messages || []) {
    if (!item.id) continue;
    const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const message = await messageResponse.json().catch(() => ({}));
    if (!messageResponse.ok) continue;
    const headers = message.payload && message.payload.headers ? message.payload.headers : [];
    leads.push(buildEstimateLeadCandidate({
      messageId: item.id,
      threadId: item.threadId,
      sender: getHeaderValue(headers, "From") || "Unknown sender",
      subject: getHeaderValue(headers, "Subject") || "(No subject)",
      date: getHeaderValue(headers, "Date") || "",
      snippet: message.snippet || "",
      photosAttached: payloadHasAttachment(message.payload),
    }));
  }

  const hotCount = leads.filter((lead) => lead.status === "hot_estimate_lead").length;
  const needsReplyCount = leads.filter((lead) => lead.status === "needs_reply").length;
  return {
    id,
    ranAt,
    configured: true,
    authMode: "oauth-refresh-token",
    query,
    lookbackDays,
    leads,
    summary: `Found ${leads.length} possible estimate emails: ${hotCount} hot lead(s), ${needsReplyCount} needing review.`,
  };
}

function getEmailsFromEnv(name) {
  return (process.env[name] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function getUserRole(email) {
  if (!email) return "operator";
  if (getEmailsFromEnv("ADMIN_EMAILS").includes(email)) return "admin";
  if (getEmailsFromEnv("APPROVER_EMAILS").includes(email)) return "approver";
  return "operator";
}

async function getOverviewForCloud(req) {
  const db = admin.firestore();
  const [runsSnapshot, templatesSnapshot] = await Promise.all([
    db.collection("bizbot_run_history").orderBy("completedAt", "desc").limit(20).get().catch(() => null),
    db.collection("bizbot_run_templates").orderBy("createdAt", "desc").limit(20).get().catch(() => null),
  ]);

  const recentRuns = runsSnapshot ? runsSnapshot.docs.map((doc) => doc.data()) : [];
  const recentTemplates = templatesSnapshot ? templatesSnapshot.docs.map((doc) => doc.data()) : [];

  return {
    registeredTools: [],
    healingRecipes: [],
    approvals: [],
    approvalPolicy: APPROVAL_POLICY,
    currentUserRole: req.userRole || "operator",
    browser: {
      sessionOpen: false,
      headless: true,
      artifactsDir: "Cloud runtime unavailable",
      recentTrace: [],
      currentUrl: "",
      lastError: CLOUD_LIMITATION_MESSAGE,
    },
    schedules: [],
    jobRuns: [],
    telemetry: {
      pendingApprovals: 0,
      approvedApprovals: 0,
      rejectedApprovals: 0,
      activeSchedules: 0,
      runningJobs: 0,
      completedJobs: recentRuns.filter((entry) => entry && entry.status === "completed").length,
      failedJobs: recentRuns.filter((entry) => entry && entry.status === "failed").length,
      browserSuccesses: 0,
      browserFailures: 0,
    },
    relay: {
      allowedCommands: [],
      allowedRoots: [],
    },
    limits: {
      maxHealingSteps: 12,
      maxFetchedPageChars: 12000,
      maxCrawlPages: 20,
    },
    cloudMode: true,
    historyStats: {
      recentRuns: recentRuns.length,
      recentTemplates: recentTemplates.length,
    },
  };
}

function unsupportedCloudAction(res) {
  return res.status(400).json({ error: CLOUD_LIMITATION_MESSAGE });
}

function isCloudAuthBypassEnabled() {
  if (process.env.AUTH_DISABLED !== "true") return false;
  if (process.env.FUNCTIONS_EMULATOR === "true") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ALLOW_INSECURE_CLOUD_AUTH_BYPASS === "true";
}

async function requireAuth(req, res, next) {
  try {
    if (isCloudAuthBypassEnabled()) return next();
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
    req.userEmail = email || undefined;
    req.userRole = getUserRole(email || undefined);
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

/** Prefer SDK text(); fall back to candidate parts (skips thought-only parts). */
function extractVisibleText(rawResponse) {
  if (!rawResponse) return "";
  try {
    const t = rawResponse.text();
    if (typeof t === "string" && t.trim()) return t.trim();
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    if (/blocked|safety|not supported|no candidates|empty/i.test(msg)) return "";
  }
  try {
    const cands = rawResponse.candidates;
    if (!Array.isArray(cands) || !cands[0] || !cands[0].content || !Array.isArray(cands[0].content.parts)) return "";
    let acc = "";
    for (const part of cands[0].content.parts) {
      if (part && part.thought) continue;
      if (part && typeof part.text === "string") acc += part.text;
    }
    return acc.trim();
  } catch (_) {
    return "";
  }
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
            name: "route_to_agent",
            description:
              "Hand work off to another BizBot agent so execution can continue with the best specialist. The browser client performs the handoff.",
            parameters: {
              type: "object",
              properties: {
                agentId: { type: "string", description: "The target BizBot agent id (e.g. seo-strategist, dashboard-ops)." },
                prompt: { type: "string", description: "The exact prompt or task brief for the target agent." },
                reason: { type: "string", description: "Short explanation for why the handoff is happening." },
              },
              required: ["agentId", "prompt"],
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
          {
            name: "scan_gmail_estimate_leads",
            description: "Scan connected Gmail read-only for Carolina Wheel Werkz customer estimate, quote, wheel repair, powder coating, curb rash, appointment, and voicemail leads. This cannot send, delete, archive, or modify email.",
            parameters: {
              type: "object",
              properties: {
                lookbackDays: {
                  type: "number",
                  description: "How many recent days to scan, between 1 and 14. Defaults to 2.",
                },
                maxResults: {
                  type: "number",
                  description: "Maximum Gmail messages to inspect, between 1 and 50. Defaults to 20.",
                },
              },
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
      systemInstruction: [
        systemInstruction || "You are a helpful business assistant.",
        "Gmail estimate scanner rule: you have a read-only tool named scan_gmail_estimate_leads for finding Carolina Wheel Werkz customer estimate leads. Use it when asked to scan Gmail/email for estimates, quotes, wheel repair requests, voicemails, or customer leads. Never claim email scanning is unavailable if this tool is listed. It cannot send, delete, archive, label, or modify emails.",
      ].join("\n\n"),
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

    let ranServerToolFollowup = false;
    let conversationAfterTools = null;

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
        } else if (c.name === "scan_gmail_estimate_leads") {
          const scanResult = await runEstimateLeadScan({
            lookbackDays: c.args && c.args.lookbackDays,
            maxResults: c.args && c.args.maxResults,
          });
          toolResponses.push({
            functionResponse: {
              name: "scan_gmail_estimate_leads",
              response: scanResult,
            },
          });
        } else if (["bash", "read_file", "write_file", "edit_file", "route_to_agent"].includes(c.name)) {
          // Executed by the browser client (relay bridge or agent handoff).
          returnToClient = true;
        }
      }
      
      if (returnToClient) {
        // Return the function call to the client
        return res.json({ functionCalls: call });
      }

      if (toolResponses.length > 0) {
        conversationAfterTools = [
          ...contents,
          { role: "model", parts: call.map((c) => ({ functionCall: c })) },
          { role: "function", parts: toolResponses },
        ];
        const secondResult = await geminiModel.generateContent({ contents: conversationAfterTools });
        response = await secondResult.response;
        ranServerToolFollowup = true;
      }
    }

    let text = extractVisibleText(response);
    const finishReason = response && response.candidates && response.candidates[0] && response.candidates[0].finishReason;
    if (!text && /SAFETY|BLOCKLIST|PROHIBITED/i.test(String(finishReason || ""))) {
      return res.status(422).json({ error: "Response was blocked.", details: "Try rephrasing." });
    }
    if (!text && ranServerToolFollowup && conversationAfterTools) {
      const nudgeContents = [
        ...conversationAfterTools,
        {
          role: "user",
          parts: [
            {
              text: "Produce a concise final answer for the user using the tool results and context above. If some data was missing or empty, say what was unavailable. Do not return an empty response.",
            },
          ],
        },
      ];
      const nudgeResult = await geminiModel.generateContent({ contents: nudgeContents });
      response = await nudgeResult.response;
      text = extractVisibleText(response);
    }
    if (!text) {
      text =
        "I could not get a clean model reply on this turn (empty response after tools). Please retry your message once; if it repeats, try a shorter prompt or a different agent.";
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

apiRouter.get("/autonomy/overview", async (req, res) => {
  try {
    res.json(await getOverviewForCloud(req));
  } catch (error) {
    console.error("autonomy overview", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to load cloud autonomy overview." });
  }
});

apiRouter.get("/agents", async (_req, res) => {
  try {
    const snapshot = await admin.firestore()
      .collection("bizbot_custom_agents")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get()
      .catch(() => null);
    res.json({ agents: snapshot ? snapshot.docs.map((doc) => doc.data()) : [] });
  } catch (error) {
    console.error("agents list", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to load agent registry." });
  }
});

apiRouter.post("/agents", async (req, res) => {
  try {
    const payload = req.body || {};
    const name = String(payload.name || "").trim();
    const id = String(payload.id || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    if (!id || !name || !payload.role || !payload.description || !payload.systemInstruction) {
      return res.status(400).json({ error: "Agent id, name, role, description, and systemInstruction are required." });
    }
    const entry = {
      id,
      name,
      role: String(payload.role),
      description: String(payload.description),
      systemInstruction: String(payload.systemInstruction),
      autonomous: true,
      icon: String(payload.icon || "Bot"),
      color: String(payload.color || "bg-cyber-blue"),
      suggestedPrompts: Array.isArray(payload.suggestedPrompts) ? payload.suggestedPrompts.map(String).slice(0, 6) : [],
      createdAt: new Date().toISOString(),
    };
    await admin.firestore().collection("bizbot_custom_agents").doc(id).set(entry, { merge: true });
    res.json(entry);
  } catch (error) {
    console.error("agents save", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to save agent." });
  }
});

apiRouter.get("/diagnostics/server", async (req, res) => {
  try {
    const overview = await getOverviewForCloud(req);
    res.json({
      storageMode: "firestore-cloud",
      workerAuthMode: process.env.WORKER_API_KEY ? "api-key" : "dev-fallback",
      heartbeatTtlMs: 45000,
      executionTimeouts: {
        localCommandMs: 30000,
        remoteWorkerMs: 60000,
        browserActionMs: 20000,
      },
      onlineWorkers: [],
      pendingApprovals: overview.telemetry.pendingApprovals,
      recentExecutionFailures: [],
    });
  } catch (error) {
    console.error("diagnostics server", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to load server diagnostics." });
  }
});

apiRouter.get("/diagnostics/workers", (_req, res) => {
  res.json({
    workers: [],
    recentExecutionFailures: [],
  });
});

apiRouter.get("/diagnostics/workers/:id", (req, res) => {
  res.status(404).json({ error: `Worker ${req.params.id} is not registered in hosted Firebase mode.` });
});

apiRouter.post("/diagnostics/test", (_req, res) => {
  res.status(400).json({
    ok: false,
    success: false,
    error: CLOUD_LIMITATION_MESSAGE,
    type: "capability_missing",
    executor: "unavailable",
  });
});

apiRouter.get("/integrations/gmail/estimate-scanner/status", (_req, res) => {
  res.json(getGmailScannerStatus());
});

apiRouter.post("/integrations/gmail/estimate-scanner/run", async (req, res) => {
  try {
    res.json(await runEstimateLeadScan(req.body || {}));
  } catch (error) {
    console.error("estimate scanner", error && error.message ? error.message : error);
    res.status(400).json({ error: error && error.message ? error.message : "Unable to run estimate scanner." });
  }
});

apiRouter.post("/autonomy/tools", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/tools/run", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/install-package", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/healing-recipes", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/healing-recipes/run", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/self-heal", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/approvals/:id/approve", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/approvals/:id/reject", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/schedules", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/schedules/:id/toggle", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/schedules/:id/run", (_req, res) => unsupportedCloudAction(res));
apiRouter.post("/autonomy/browser/replay", (_req, res) => unsupportedCloudAction(res));

apiRouter.get("/history/runs", async (_req, res) => {
  try {
    const snapshot = await admin.firestore()
      .collection("bizbot_run_history")
      .orderBy("completedAt", "desc")
      .limit(100)
      .get();
    res.json({ runs: snapshot.docs.map((doc) => doc.data()) });
  } catch (error) {
    console.error("history runs", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to read run history." });
  }
});

apiRouter.post("/history/runs", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.id || !payload.agentId || !payload.title || !payload.startedAt || !payload.completedAt || !payload.status) {
      return res.status(400).json({ error: "Missing required run summary fields." });
    }
    const entry = {
      id: String(payload.id),
      agentId: String(payload.agentId),
      title: String(payload.title),
      sourcePrompt: String(payload.sourcePrompt || ""),
      startedAt: String(payload.startedAt),
      completedAt: String(payload.completedAt),
      status: payload.status === "failed" ? "failed" : "completed",
      handoffCount: Number(payload.handoffCount || 0),
      approvalCount: Number(payload.approvalCount || 0),
      workflowLaunched: Boolean(payload.workflowLaunched),
      notes: String(payload.notes || ""),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await admin.firestore().collection("bizbot_run_history").doc(entry.id).set(entry, { merge: true });
    res.json(entry);
  } catch (error) {
    console.error("save run history", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to save run history." });
  }
});

apiRouter.get("/history/templates", async (_req, res) => {
  try {
    const snapshot = await admin.firestore()
      .collection("bizbot_run_templates")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();
    res.json({ templates: snapshot.docs.map((doc) => doc.data()) });
  } catch (error) {
    console.error("history templates", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to read run templates." });
  }
});

apiRouter.post("/history/templates", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.id || !payload.name || !payload.agentId || !payload.prompt || !payload.createdAt || !payload.sourceRunId) {
      return res.status(400).json({ error: "Missing required run template fields." });
    }
    const entry = {
      id: String(payload.id),
      name: String(payload.name),
      agentId: String(payload.agentId),
      prompt: String(payload.prompt),
      createdAt: String(payload.createdAt),
      sourceRunId: String(payload.sourceRunId),
      notes: typeof payload.notes === "string" ? payload.notes : "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await admin.firestore().collection("bizbot_run_templates").doc(entry.id).set(entry, { merge: true });
    res.json(entry);
  } catch (error) {
    console.error("save run template", error && error.message ? error.message : error);
    res.status(500).json({ error: "Unable to save run template." });
  }
});

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
  invoker: "public",
  secrets: [
    "GEMINI_API_KEY",
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
  ],
}, app);
