import fs from "node:fs";
import { execFile } from "node:child_process";
import { validateRelayCommand, type CommandPolicy } from "./commandPolicy";
import { resolveRelayPath, type FilePolicy } from "./filePolicy";
import { executionError, normalizeExecutionError } from "./errors";
import { logWorkerEvent } from "./logger";
import type { ExecutionRequest, ExecutionResponse, Executor } from "./types";

export type LocalExecutorOptions = {
  commandPolicy: CommandPolicy;
  filePolicy: FilePolicy;
  defaultCwd: string;
  timeoutMs?: number;
};

export class LocalExecutor implements Executor {
  constructor(private readonly options: LocalExecutorOptions) {}

  private timeoutMs() {
    return this.options.timeoutMs || 60_000;
  }

  private async withTimeout<T>(operation: Promise<T>, startedAt: number): Promise<T | ExecutionResponse> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<ExecutionResponse>((resolve) => {
      timeout = setTimeout(() => {
        resolve(executionError({
          error: "Execution timed out",
          type: "timeout",
          executor: "local",
          durationMs: Date.now() - startedAt,
        }));
      }, this.timeoutMs());
    });

    const result = await Promise.race([operation, timeoutPromise]);
    if (timeout) clearTimeout(timeout);
    return result;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    try {
      switch (request.kind) {
        case "command":
          return await this.executeCommand(request);
        case "file.read":
          return await this.readFile(request);
        case "file.write":
          return await this.writeFile(request);
        case "file.edit":
          return await this.editFile(request);
        default:
          return {
            ok: false,
            executor: "unavailable",
            unavailableReason: `Local executor does not support ${request.kind}.`,
          };
      }
    } catch (error) {
      return normalizeExecutionError(error, "validation", "local");
    }
  }

  private async executeCommand(request: ExecutionRequest): Promise<ExecutionResponse> {
    const startedAt = Date.now();
    const { executable, args } = validateRelayCommand(String(request.command || ""), this.options.commandPolicy);
    const cwd = resolveRelayPath(
      request.workdir && request.workdir.trim() ? request.workdir : this.options.defaultCwd,
      this.options.filePolicy,
    );

    logWorkerEvent("command.start", { executor: "local", command: executable, cwd });

    return new Promise((resolve) => {
      execFile(executable, args, { cwd, timeout: this.timeoutMs() }, (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        if (error && error.killed) {
          logWorkerEvent("command.timeout", { executor: "local", command: executable, durationMs });
          resolve(executionError({
            error: "Execution timed out",
            type: "timeout",
            executor: "local",
            durationMs,
          }));
          return;
        }

        if (error && typeof error.code !== "number") {
          logWorkerEvent("command.fail", { executor: "local", command: executable, durationMs, error: error.message });
          resolve(executionError({
            error: error.message,
            type: "execution",
            executor: "local",
            durationMs,
          }));
          return;
        }

        const result = {
          ok: !error || error.code === 0,
          success: !error || error.code === 0,
          executor: "local",
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode: typeof error?.code === "number" ? error.code : 0,
          signal: error?.signal || null,
          durationMs,
        } satisfies ExecutionResponse;
        logWorkerEvent(result.ok ? "command.success" : "command.fail", {
          executor: "local",
          command: executable,
          durationMs,
          exitCode: result.exitCode,
        });
        resolve(result);
      });
    });
  }

  private async readFile(request: ExecutionRequest): Promise<ExecutionResponse> {
    if (!request.path) {
      throw new Error("No path provided.");
    }
    const startedAt = Date.now();
    const result = await this.withTimeout(
      fs.promises.readFile(resolveRelayPath(request.path, this.options.filePolicy), "utf8"),
      startedAt,
    );
    if (typeof result !== "string") return result;
    return { ok: true, success: true, executor: "local", content: result, durationMs: Date.now() - startedAt };
  }

  private async writeFile(request: ExecutionRequest): Promise<ExecutionResponse> {
    if (!request.path || request.content === undefined) {
      throw new Error("Missing path or content.");
    }
    const startedAt = Date.now();
    const result = await this.withTimeout(
      fs.promises.writeFile(resolveRelayPath(request.path, this.options.filePolicy), String(request.content), "utf8"),
      startedAt,
    );
    if (result && typeof result === "object" && "ok" in result) return result;
    return { ok: true, executor: "local", success: true, durationMs: Date.now() - startedAt };
  }

  private async editFile(request: ExecutionRequest): Promise<ExecutionResponse> {
    if (!request.path || !request.oldString || request.newString === undefined) {
      throw new Error("Missing required fields.");
    }
    const startedAt = Date.now();
    const fullPath = resolveRelayPath(request.path, this.options.filePolicy);
    const readResult = await this.withTimeout(fs.promises.readFile(fullPath, "utf8"), startedAt);
    if (typeof readResult !== "string") return readResult;
    const content = readResult;
    if (!content.includes(request.oldString)) {
      throw new Error("oldString not found in file.");
    }
    const writeResult = await this.withTimeout(
      fs.promises.writeFile(fullPath, content.replace(request.oldString, String(request.newString)), "utf8"),
      startedAt,
    );
    if (writeResult && typeof writeResult === "object" && "ok" in writeResult) return writeResult;
    return { ok: true, executor: "local", success: true, durationMs: Date.now() - startedAt };
  }
}
