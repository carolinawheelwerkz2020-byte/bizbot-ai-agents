export type CommandPolicy = {
  allowedCommands: Set<string>;
  allowAllCommands: boolean;
  allowShellOperators: boolean;
};

export function createCommandPolicy(commands: Iterable<string>): CommandPolicy {
  const normalized = [...commands].map((command) => command.toLowerCase());
  const allowAllCommands = normalized.includes("*");
  return {
    allowedCommands: new Set(normalized.filter((command) => command !== "*")),
    allowAllCommands,
    allowShellOperators: process.env.RELAY_ALLOW_SHELL_OPERATORS === "true",
  };
}

export function tokenizeCommand(command: string, allowShellOperators = process.env.RELAY_ALLOW_SHELL_OPERATORS === "true") {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("No command provided.");
  }

  if (/\brm\s+-rf\b/i.test(trimmed) || /\bsudo\b/i.test(trimmed)) {
    throw new Error("Blocked by command policy: sudo and destructive rm -rf are not allowed.");
  }

  if (/[|&;><`$]/.test(trimmed) && !allowShellOperators) {
    throw new Error("Blocked by command policy: shell operators and substitutions are not allowed unless RELAY_ALLOW_SHELL_OPERATORS=true.");
  }

  return trimmed.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
}

export function validateRelayCommand(command: string, policy: CommandPolicy) {
  const parts = tokenizeCommand(command, policy.allowShellOperators);
  const executable = parts[0]?.toLowerCase();
  if (!executable || (!policy.allowAllCommands && !policy.allowedCommands.has(executable))) {
    throw new Error(`Command "${parts[0] || ""}" is not allowed by the relay policy.`);
  }
  return {
    executable: parts[0],
    args: parts.slice(1),
  };
}
