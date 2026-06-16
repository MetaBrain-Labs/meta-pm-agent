import { PrismaClient } from "@prisma/client";

const databaseUrl = buildDatabaseUrl();
if (databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function buildDatabaseUrl(): string | undefined {
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

function normalizeSslMode(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "true") return "require";
  if (value === "false") return "disable";
  return value;
}
