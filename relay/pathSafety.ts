import path from "node:path";

function normalizeForCompare(inputPath: string) {
  return inputPath.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

export function normalizePath(inputPath: string, rootPath?: string) {
  const rawPath = inputPath.trim();
  if (!rawPath) {
    throw new Error("No path provided.");
  }

  const pathApi = /^[a-zA-Z]:[\\/]/.test(rawPath) || rawPath.includes("\\") ? path.win32 : path;
  const base = rootPath ? normalizePath(rootPath) : undefined;
  const resolved = pathApi.isAbsolute(rawPath)
    ? pathApi.resolve(rawPath)
    : pathApi.resolve(base || process.cwd(), rawPath);

  return resolved;
}

export function isPathWithinRoot(targetPath: string, rootPath: string) {
  const normalizedTarget = normalizeForCompare(normalizePath(targetPath));
  const normalizedRoot = normalizeForCompare(normalizePath(rootPath));

  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

