import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { createCommandPolicy } from "../relay/commandPolicy";
import { createFilePolicy } from "../relay/filePolicy";
import { LocalExecutor } from "../relay/localExecutor";
import { executionError } from "../relay/errors";
import { isWorkerRequestAuthorized, getWorkerApiKey, unauthorizedWorkerResponse } from "../relay/workerAuth";
import { logWorkerEvent } from "../relay/logger";
import type { ExecutionRequest, WorkerCapability, WorkerPlatform } from "../relay/types";

dotenv.config({ path: path.join(process.cwd(), ".env") });
dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: true });

const MAIN_API_URL = process.env.WORKER_MAIN_API_URL || process.env.VITE_API_BASE_URL || "http://localhost:3000";
const WORKER_ID = process.env.WORKER_ID || `${os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${process.pid}`;
const WORKER_NAME = process.env.WORKER_NAME || `${os.hostname()} worker`;
const WORKER_PORT = Number(process.env.WORKER_PORT || 4317);
const WORKER_HOST = process.env.WORKER_HOST || `http://localhost:${WORKER_PORT}`;
const WORKER_ROOT = path.resolve(process.env.WORKER_ROOT || process.cwd());
const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS || 15_000);
const WORKER_COMMAND_TIMEOUT_MS = Number(process.env.WORKER_COMMAND_TIMEOUT_MS || 60_000);
const WORKER_NETWORK_TIMEOUT_MS = Number(process.env.WORKER_NETWORK_TIMEOUT_MS || 30_000);

const defaultAllowedCommands = "npm,npx,node,git,tsx,tsc,vite,pnpm,yarn,bun,python,python3,pip,pip3,uv,make,sh,bash,zsh";
const allowedCommands = (process.env.WORKER_ALLOWED_COMMANDS || process.env.RELAY_ALLOWED_COMMANDS || defaultAllowedCommands)
  .split(",")
  .map((command) => command.trim())
  .filter(Boolean);

const capabilities = normalizeCapabilities(process.env.WORKER_CAPABILITIES);
const executor = new LocalExecutor({
  commandPolicy: createCommandPolicy(allowedCommands),
  filePolicy: createFilePolicy([WORKER_ROOT]),
  defaultCwd: WORKER_ROOT,
  timeoutMs: WORKER_COMMAND_TIMEOUT_MS,
  allowShellSyntax: process.env.RELAY_ALLOW_SHELL_OPERATORS === "true",
});

function detectPlatform(): WorkerPlatform {
  switch (process.platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "unknown";
  }
}

function normalizeCapabilities(raw?: string): WorkerCapability[] {
  const defaults: WorkerCapability[] = ["shell", "filesystem", "git", "npm", "tool"];
  const values = (raw ? raw.split(",") : defaults)
    .map((value) => value.trim())
    .filter(Boolean);
  return values.filter((value): value is WorkerCapability =>
    value === "shell"
    || value === "filesystem"
    || value === "git"
    || value === "npm"
    || value === "playwright"
    || value === "browser"
    || value === "seo_audit"
    || value === "memory"
    || value === "scheduler"
    || value === "tool"
    || value === "command"
    || value === "file:read"
    || value === "file:write"
    || value === "file:edit",
  );
}

async function postToMain(pathname: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_NETWORK_TIMEOUT_MS);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const workerApiKey = getWorkerApiKey();
  if (workerApiKey) {
    headers.Authorization = `Bearer ${workerApiKey}`;
  }

  try {
    const response = await fetch(new URL(pathname, MAIN_API_URL), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Main API ${pathname} failed with ${response.status}: ${text}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function runSelfCheck() {
  const selfCheck: Record<string, boolean | string> = {
    shell: allowedCommands.length > 0,
    filesystem: false,
    playwright: false,
  };

  try {
    fs.accessSync(WORKER_ROOT, fs.constants.R_OK | fs.constants.W_OK);
    selfCheck.filesystem = true;
  } catch (error) {
    selfCheck.filesystemError = error instanceof Error ? error.message : "Filesystem check failed.";
  }

  try {
    await import("playwright");
    selfCheck.playwright = true;
  } catch {
    selfCheck.playwright = false;
  }

  return selfCheck;
}

async function registerWorker() {
  const selfCheck = await runSelfCheck();
  return postToMain("/api/workers/register", {
    id: WORKER_ID,
    name: WORKER_NAME,
    platform: detectPlatform(),
    capabilities,
    selfCheck,
    endpoint: WORKER_HOST,
    host: os.hostname(),
    metadata: {
      root: WORKER_ROOT,
      pid: process.pid,
      node: process.version,
      allowedCommands,
      commandTimeoutMs: WORKER_COMMAND_TIMEOUT_MS,
    },
  });
}

async function heartbeat(currentTask?: string, currentTaskId?: string) {
  return postToMain(`/api/workers/${encodeURIComponent(WORKER_ID)}/heartbeat`, {
    status: currentTask ? "busy" : "online",
    currentTask,
    currentTaskId,
  });
}

async function start() {
  const app = express();
  app.use(express.json({ limit: "100mb" }));

  app.use((req, res, next) => {
    if (req.path !== "/execute") return next();
    const auth = isWorkerRequestAuthorized(req.headers);
    if (auth.ok) return next();
    logWorkerEvent("worker.execute.auth_fail", { workerId: WORKER_ID, result: "fail" });
    return res.status(401).json(unauthorizedWorkerResponse());
  });

  app.get("/health", (_req, res) => {
    res.json({
      id: WORKER_ID,
      name: WORKER_NAME,
      platform: detectPlatform(),
      capabilities,
      root: WORKER_ROOT,
    });
  });

  app.post("/execute", async (req, res) => {
    const request = req.body as ExecutionRequest;
    const taskLabel = request.taskId || request.kind;
    const startedAt = Date.now();
    try {
      logWorkerEvent("worker.execute.start", {
        workerId: WORKER_ID,
        action: request.kind,
        taskId: request.taskId,
      });
      await heartbeat(taskLabel, request.taskId);
      const result = await executor.execute(request);
      await heartbeat();
      logWorkerEvent(result.ok ? "worker.execute.success" : "worker.execute.fail", {
        workerId: WORKER_ID,
        action: request.kind,
        taskId: request.taskId,
        durationMs: Date.now() - startedAt,
        error: result.error,
      });
      res.status(result.ok ? 200 : 400).json({
        ...result,
        workerId: WORKER_ID,
        metadata: {
          ...(result.metadata || {}),
          platform: detectPlatform(),
          workerRoot: WORKER_ROOT,
        },
      });
    } catch (error) {
      await heartbeat().catch(() => undefined);
      const result = executionError({
        error: error instanceof Error ? error.message : "Worker execution failed.",
        type: "execution",
        executor: "remote",
        workerId: WORKER_ID,
        durationMs: Date.now() - startedAt,
      });
      logWorkerEvent("worker.execute.fail", {
        workerId: WORKER_ID,
        action: request.kind,
        taskId: request.taskId,
        durationMs: result.durationMs,
        error: result.error,
      });
      res.status(500).json(result);
    }
  });

  app.listen(WORKER_PORT, async () => {
    console.log(`BizBot worker ${WORKER_ID} listening on ${WORKER_HOST}`);
    await registerWorker();
    await heartbeat();
    setInterval(() => {
      heartbeat().catch((error) => {
        console.error("[worker heartbeat]", error instanceof Error ? error.message : error);
      });
    }, HEARTBEAT_MS);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
