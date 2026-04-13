import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@prisma/client";
import { describeSqliteDatabaseTarget, resolveDatabaseUrl } from "../../../prisma/databaseUrl";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const databaseUrl = resolveDatabaseUrl();
const adapter = new PrismaBetterSqlite3({
  url: databaseUrl,
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error"],
  });

function assertGeneratedClientSupportsRuntimeSchema(): void {
  const modelByName = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [model.name, model])
  );

  const requiredFields = [
    ["Team", "mapBan"],
    ["MatchAssignment", "assignedMap"],
    ["CashoutPlacement", "assignedMap"],
    ["CashoutPlacement", "isOfficial"],
  ] as const;

  const missing = requiredFields.filter(([modelName, fieldName]) => {
    const model = modelByName.get(modelName);
    return !model?.fields.some((field) => field.name === fieldName);
  });

  if (missing.length > 0) {
    const missingLabels = missing
      .map(([modelName, fieldName]) => `${modelName}.${fieldName}`)
      .join(", ");
    throw new Error(
      `Generated Prisma client is stale. Missing fields: ${missingLabels}. Run \"npm run prisma:generate\" and restart the bot.`
    );
  }
}

assertGeneratedClientSupportsRuntimeSchema();

function assertRequiredPrismaDelegates(): void {
  const delegateNames = ["activePanelMessage", "savedPanelContext"] as const;
  const missing = delegateNames.filter((delegateName) => !prisma[delegateName]);

  if (missing.length > 0) {
    throw new Error(
      `Panel lifecycle models are not available on Prisma client. Run migrations and regenerate the Prisma client before starting the bot. Missing delegates: ${missing.join(
        ", "
      )}.`
    );
  }
}

export function validateBotPrismaClient(): void {
  assertRequiredPrismaDelegates();
}

export function logResolvedDatabaseTarget(): void {
  const target = describeSqliteDatabaseTarget(databaseUrl);
  console.info("[db] Prisma datasource resolved", {
    databaseUrl: target.databaseUrl,
    resolvedPath: target.resolvedPath,
    cwd: process.cwd(),
  });
}

async function assertPanelLifecycleTablesExist(): Promise<void> {
  const tableNames = ["ActivePanelMessage", "SavedPanelContext"] as const;
  const rows = (await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${tableNames
      .map((name) => `'${name}'`)
      .join(",")})`
  )) as { name: string }[];
  const existing = new Set(rows.map((row) => row.name));
  const missing = tableNames.filter((tableName) => !existing.has(tableName));
  if (missing.length > 0) {
    throw new Error(
      `Database schema is out of date: ActivePanelMessage/SavedPanelContext tables are missing. Run Prisma migration against the active bot database. Missing: ${missing.join(
        ", "
      )}.`
    );
  }
}

export async function validatePanelLifecycleSchema(): Promise<void> {
  await assertPanelLifecycleTablesExist();
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type PrismaTransactionClient = Prisma.TransactionClient;
export type PrismaDbClient = PrismaClient | PrismaTransactionClient;
