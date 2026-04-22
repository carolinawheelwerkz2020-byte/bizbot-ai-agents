import { isPathWithinRoot, normalizePath } from "./pathSafety";

export type FilePolicy = {
  allowedRoots: string[];
};

export function createFilePolicy(roots: string[]): FilePolicy {
  return {
    allowedRoots: roots.map((root) => normalizePath(root)),
  };
}

export function isPathInsideRoot(targetPath: string, rootPath: string) {
  return isPathWithinRoot(targetPath, rootPath);
}

export function resolveRelayPath(inputPath: string, policy: FilePolicy) {
  const resolvedPath = normalizePath(inputPath);
  const isAllowed = policy.allowedRoots.some((root) => isPathInsideRoot(resolvedPath, root));
  if (!isAllowed) {
    throw new Error("Requested path is outside the allowed relay workspace.");
  }
  return resolvedPath;
}
