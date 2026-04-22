import path from "node:path";
import { createCommandPolicy } from "../relay/commandPolicy";
import { createFilePolicy } from "../relay/filePolicy";
import { ExecutionRouter } from "../relay/executionRouter";
import { LocalExecutor } from "../relay/localExecutor";
import { WorkerRegistry } from "../storage/workerRegistry";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const root = path.resolve(process.cwd());
  const registry = new WorkerRegistry(1_000);
  const worker = registry.register({
    id: "validation-worker",
    name: "Validation Worker",
    platform: "mac",
    capabilities: ["shell", "filesystem"],
    verifiedCapabilities: ["shell", "filesystem"],
    endpoint: "http://127.0.0.1:9",
    metadata: { validation: true },
  });

  assert(worker.status === "online", "worker registration failed");
  const heartbeat = registry.heartbeat(worker.id);
  assert(heartbeat.lastHeartbeatAt, "worker heartbeat failed");

  const localExecutor = new LocalExecutor({
    commandPolicy: createCommandPolicy(["node"]),
    filePolicy: createFilePolicy([root]),
    defaultCwd: root,
    timeoutMs: 5_000,
  });

  const blocked = await localExecutor.execute({
    kind: "command",
    command: "node -v && rm -rf /",
    workdir: root,
  });
  assert(!blocked.ok && blocked.type === "validation", "dangerous command was not blocked");

  const pathEscape = await localExecutor.execute({
    kind: "file.read",
    path: "../outside.txt",
  });
  assert(!pathEscape.ok && pathEscape.type === "validation", "path traversal was not blocked");

  const router = new ExecutionRouter({
    localExecutor,
    workerRegistry: registry,
    preferRemote: true,
  });
  const unavailable = await router.execute({
    kind: "browser.action",
    browserAction: "noop",
  });
  assert(!unavailable.ok && unavailable.type === "capability_missing", "routing fallback did not report missing capability");

  console.log("Worker system validation passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
