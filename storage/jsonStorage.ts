import fs from "node:fs";

export function readJsonArrayFile<T>(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return [] as T[];
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [] as T[];
  }
}

export function writeJsonArrayFile<T>(filePath: string, data: T[]) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export class JsonCollection<T extends { id: string }> {
  constructor(private readonly filePath: string) {}

  list() {
    return readJsonArrayFile<T>(this.filePath).filter((entry) => entry && typeof entry.id === "string");
  }

  upsert(entry: T, limit = 100) {
    const existing = this.list().filter((item) => item.id !== entry.id);
    const next = [entry, ...existing].slice(0, limit);
    writeJsonArrayFile(this.filePath, next);
    return entry;
  }

  replace(entries: T[]) {
    writeJsonArrayFile(this.filePath, entries);
  }
}
