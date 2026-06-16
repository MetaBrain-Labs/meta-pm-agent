import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

loadEnvFile(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../.env",
  ),
);

const databaseUrl = buildDatabaseUrl();
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-database-url.mjs <command> [...args]");
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function buildDatabaseUrl() {
  const host = process.env.POSTGRES_HOST?.trim();
  if (!host) {
    return process.env.DATABASE_URL;
  }

  const port = process.env.POSTGRES_PORT?.trim() || "5432";
  const user = process.env.POSTGRES_USER?.trim() || "postgres";
  const password = process.env.POSTGRES_PASSWORD ?? "";
  const database = process.env.POSTGRES_DB?.trim() || "postgres";
  const schema = process.env.POSTGRES_SCHEMA?.trim();
  const sslMode = normalizeSslMode(process.env.POSTGRES_SSL);

  const auth = password.length > 0
    ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}`
    : encodeURIComponent(user);
  const params = new URLSearchParams();

  if (sslMode) {
    params.set("sslmode", sslMode);
  }
  if (schema) {
    params.set("schema", schema);
  }

  const query = params.size > 0 ? `?${params.toString()}` : "";
  return `postgresql://${auth}@${host}:${port}/${encodeURIComponent(database)}${query}`;
}

function normalizeSslMode(raw) {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "true") return "require";
  if (value === "false") return "disable";
  return value;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
