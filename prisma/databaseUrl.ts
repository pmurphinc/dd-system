import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SQLITE_PATH = path.join(REPO_ROOT, "dev.db");

export const DEFAULT_DATABASE_URL = `file:${DEFAULT_SQLITE_PATH}`;

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DATABASE_URL?.trim();
  if (!configured) {
    return DEFAULT_DATABASE_URL;
  }

  if (!configured.startsWith("file:")) {
    return configured;
  }

  const [base, queryString] = configured.split("?");
  const withoutProtocol = (base ?? "").slice("file:".length);
  const decodedPath = decodeURIComponent(withoutProtocol);
  if (!decodedPath || decodedPath === ":memory:" || path.isAbsolute(decodedPath)) {
    return configured;
  }

  const absolutePath = path.resolve(REPO_ROOT, decodedPath);
  return `file:${absolutePath}${queryString ? `?${queryString}` : ""}`;
}

export function describeSqliteDatabaseTarget(databaseUrl: string): {
  databaseUrl: string;
  resolvedPath: string | null;
} {
  if (!databaseUrl.startsWith("file:")) {
    return { databaseUrl, resolvedPath: null };
  }

  const withoutProtocol = databaseUrl.slice("file:".length).split("?")[0] ?? "";
  const decodedPath = decodeURIComponent(withoutProtocol);
  if (!decodedPath || decodedPath === ":memory:") {
    return { databaseUrl, resolvedPath: decodedPath || null };
  }

  const resolvedPath = path.isAbsolute(decodedPath)
    ? decodedPath
    : path.resolve(process.cwd(), decodedPath);

  return { databaseUrl, resolvedPath };
}
