import crypto from "node:crypto";
import type { Request } from "express";
import { executionError } from "./errors";

export function getWorkerApiKey() {
  return process.env.WORKER_API_KEY || process.env.BIZBOT_WORKER_API_KEY || "";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function getWorkerTokenFromHeaders(headers: Request["headers"]) {
  const bearer = headers.authorization?.startsWith("Bearer ") ? headers.authorization.slice(7) : "";
  const workerHeader = headers["x-worker-api-key"];
  return bearer || (Array.isArray(workerHeader) ? workerHeader[0] : workerHeader) || "";
}

export function isWorkerRequestAuthorized(headers: Request["headers"]) {
  const expected = getWorkerApiKey();
  if (!expected) {
    return { ok: true, devFallback: true };
  }

  const actual = getWorkerTokenFromHeaders(headers);
  return { ok: Boolean(actual) && safeEqual(actual, expected), devFallback: false };
}

export function unauthorizedWorkerResponse() {
  return executionError({
    error: "Worker API key is missing or invalid.",
    type: "auth",
    executor: "unavailable",
  });
}

