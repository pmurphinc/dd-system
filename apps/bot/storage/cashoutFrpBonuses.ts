import { PrismaDbClient, prisma } from "./prisma";
import { createAuditLog } from "./auditLog";

export interface StoredCashoutFrpBonus {
  id: number;
  tournamentInstanceId: number;
  cycleNumber: number;
  teamId: number;
  teamName: string;
  frpAwarded: number;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}

interface CashoutFrpBonusInput {
  tournamentInstanceId: number;
  cycleNumber: number;
  teamId: number;
  teamName: string;
  actorDiscordUserId: string;
}

let cashoutFrpBonusTableReady: Promise<void> | undefined;

function normalizeCashoutFrpBonus(
  record: StoredCashoutFrpBonus
): StoredCashoutFrpBonus {
  return {
    ...record,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

async function ensureCashoutFrpBonusTable(
  db: Pick<PrismaDbClient, "$executeRawUnsafe"> = prisma
): Promise<void> {
  if (db === prisma) {
    cashoutFrpBonusTableReady ??= Promise.resolve().then(async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CashoutFrpBonus" (
          "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
          "tournamentInstanceId" INTEGER NOT NULL,
          "cycleNumber" INTEGER NOT NULL,
          "teamId" INTEGER NOT NULL,
          "teamName" TEXT NOT NULL,
          "frpAwarded" INTEGER NOT NULL DEFAULT 1,
          "reason" TEXT NOT NULL DEFAULT 'CASHOUT_FIRST_PLACE',
          "createdAt" DATETIME NOT NULL,
          "updatedAt" DATETIME NOT NULL,
          CONSTRAINT "CashoutFrpBonus_tournamentInstanceId_fkey"
            FOREIGN KEY ("tournamentInstanceId")
            REFERENCES "TournamentInstance" ("id")
            ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);

      await prisma.$executeRawUnsafe(`
        CREATE UNIQUE INDEX IF NOT EXISTS "CashoutFrpBonus_tournamentInstanceId_cycleNumber_key"
        ON "CashoutFrpBonus" ("tournamentInstanceId", "cycleNumber")
      `);
    });

    await cashoutFrpBonusTableReady;
    return;
  }

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CashoutFrpBonus" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "tournamentInstanceId" INTEGER NOT NULL,
      "cycleNumber" INTEGER NOT NULL,
      "teamId" INTEGER NOT NULL,
      "teamName" TEXT NOT NULL,
      "frpAwarded" INTEGER NOT NULL DEFAULT 1,
      "reason" TEXT NOT NULL DEFAULT 'CASHOUT_FIRST_PLACE',
      "createdAt" DATETIME NOT NULL,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "CashoutFrpBonus_tournamentInstanceId_fkey"
        FOREIGN KEY ("tournamentInstanceId")
        REFERENCES "TournamentInstance" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CashoutFrpBonus_tournamentInstanceId_cycleNumber_key"
    ON "CashoutFrpBonus" ("tournamentInstanceId", "cycleNumber")
  `);
}

export async function upsertCashoutFirstPlaceFrpBonus(
  input: CashoutFrpBonusInput,
  db: PrismaDbClient = prisma
): Promise<StoredCashoutFrpBonus> {
  await ensureCashoutFrpBonusTable(db);

  // One cashout bonus exists per tournament cycle, so re-approvals and panel
  // refreshes update the same durable row instead of stacking duplicate FRP.
  const existing = await db.cashoutFrpBonus.findUnique({
    where: {
      tournamentInstanceId_cycleNumber: {
        tournamentInstanceId: input.tournamentInstanceId,
        cycleNumber: input.cycleNumber,
      },
    },
  });

  const record = existing
    ? await db.cashoutFrpBonus.update({
        where: { id: existing.id },
        data: {
          teamId: input.teamId,
          teamName: input.teamName,
          frpAwarded: 1,
          reason: "CASHOUT_FIRST_PLACE",
          updatedAt: new Date(),
        },
      })
    : await db.cashoutFrpBonus.create({
        data: {
          tournamentInstanceId: input.tournamentInstanceId,
          cycleNumber: input.cycleNumber,
          teamId: input.teamId,
          teamName: input.teamName,
          frpAwarded: 1,
          reason: "CASHOUT_FIRST_PLACE",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

  if (db === prisma) {
    await createAuditLog({
      action: "cashout_first_place_frp_awarded",
      entityType: "tournament_instance",
      entityId: `${input.tournamentInstanceId}`,
      summary: `Awarded +1 FRP for cycle ${input.cycleNumber} Cashout 1st place.`,
      details: `${input.teamName} receives +1 FRP for finishing 1st in Cashout.`,
      actorDiscordUserId: input.actorDiscordUserId,
    });
  }

  return normalizeCashoutFrpBonus(record);
}

export async function listCashoutFrpBonusesForTournamentInstance(
  tournamentInstanceId: number,
  cycleNumber?: number,
  db: PrismaDbClient = prisma
): Promise<StoredCashoutFrpBonus[]> {
  await ensureCashoutFrpBonusTable(db);

  const rows = await db.cashoutFrpBonus.findMany({
    where: {
      tournamentInstanceId,
      ...(cycleNumber === undefined ? {} : { cycleNumber }),
    },
    orderBy: [{ cycleNumber: "asc" }, { id: "asc" }],
  });

  return rows.map(normalizeCashoutFrpBonus);
}

export async function getRecentCashoutFrpBonuses(
  limit = 5,
  db: PrismaDbClient = prisma
): Promise<StoredCashoutFrpBonus[]> {
  await ensureCashoutFrpBonusTable(db);

  const rows = await db.cashoutFrpBonus.findMany({
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  return rows.map(normalizeCashoutFrpBonus);
}
