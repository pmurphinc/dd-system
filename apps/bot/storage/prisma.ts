import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
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

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type PrismaTransactionClient = Prisma.TransactionClient;
export type PrismaDbClient = PrismaClient | PrismaTransactionClient;
