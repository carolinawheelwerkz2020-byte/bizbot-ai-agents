export type CommandPolicy = {
  allowedCommands: Set<string>;
};

export function createCommandPolicy(commands: Iterable<string>): CommandPolicy {
  return {
    allowedCommands: new Set([...commands].map((command) => command.toLowerCase())),
  };
}

export function tokenizeCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("No command provided.");
  }

  if (/[|&;><`$]/.test(trimmed) || /\brm\s+-rf\b/i.test(trimmed) || /\bsudo\b/i.test(trimmed)) {
    throw new Error("Blocked by command policy: shell operators, redirection, sudo, substitutions, and destructive commands are not allowed.");
  }

  return trimmed.match(/"[^"]*"|'[^']*'|\S+/g)?.map((token) => token.replace(/^["']|["']$/g, "")) || [];
}

export function validateRelayCommand(command: string, policy: CommandPolicy) {
  const parts = tokenizeCommand(command);
  const executable = parts[0]?.toLowerCase();
  if (!executable || !policy.allowedCommands.has(executable)) {
    throw new Error(`Command "${parts[0] || ""}" is not allowed by the relay policy.`);
  }
  return {
    executable: parts[0],
    args: parts.slice(1),
  };
}
