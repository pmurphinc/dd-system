import { GuildMemberRoleManager } from "discord.js";
import { prisma } from "./prisma";
import {
  clearRegistrationImportedTeam,
  getRegistrationById,
  markRegistrationImported,
  StoredRegistrationSubmission,
} from "./registrations";
import { createAuditLog } from "./auditLog";
import { deleteSourceRowFromGoogleSheet } from "../services/googleSheetsAdmin";

export interface StoredTeamMember {
  id: number;
  teamId: number;
  displayName: string;
  discordUserId?: string;
  embarkId?: string;
  isLeader: boolean;
  sortOrder: number;
}

export interface StoredTeam {
  id: number;
  teamName: string;
  captainName: string;
  playerNames: string[];
  substituteName: string;
  discordCommunity: string | null;
  approvalStatus: string;
  checkInStatus: string;
  leaderDiscordUserId: string;
  discordRoleId: string | null;
  voiceChannelId: string | null;
  importedFromSubmissionId: number | null;
  isPlacedInEvent: boolean;
  tournamentInstanceId: number | null;
  mapBan: string | null;
  members: StoredTeamMember[];
}

let teamTablesReady: Promise<void> | undefined;

async function ensureColumn(
  tableName: string,
  columnName: string,
  alterSql: string
): Promise<void> {
  const columns = (await prisma.$queryRawUnsafe(
    `PRAGMA table_info("${tableName}")`
  )) as Array<{ name: string }>;

  if (!columns.some((column) => column.name === columnName)) {
    await prisma.$executeRawUnsafe(alterSql);
  }
}

async function ensureTeamTables(): Promise<void> {
  teamTablesReady ??= Promise.resolve().then(async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Team" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "teamName" TEXT NOT NULL,
        "captainName" TEXT NOT NULL,
        "playerNames" TEXT NOT NULL,
        "substituteName" TEXT NOT NULL,
        "discordCommunity" TEXT,
        "approvalStatus" TEXT NOT NULL,
        "checkInStatus" TEXT NOT NULL
      )
    `);

    await ensureColumn(
      "Team",
      "discordCommunity",
      `ALTER TABLE "Team" ADD COLUMN "discordCommunity" TEXT`
    );
    await ensureColumn(
      "Team",
      "leaderDiscordUserId",
      `ALTER TABLE "Team" ADD COLUMN "leaderDiscordUserId" TEXT NOT NULL DEFAULT ''`
    );
    await ensureColumn(
      "Team",
      "discordRoleId",
      `ALTER TABLE "Team" ADD COLUMN "discordRoleId" TEXT`
    );
    await ensureColumn(
      "Team",
      "voiceChannelId",
      `ALTER TABLE "Team" ADD COLUMN "voiceChannelId" TEXT`
    );
    await ensureColumn(
      "Team",
      "importedFromSubmissionId",
      `ALTER TABLE "Team" ADD COLUMN "importedFromSubmissionId" INTEGER`
    );
    await ensureColumn(
      "Team",
      "isPlacedInEvent",
      `ALTER TABLE "Team" ADD COLUMN "isPlacedInEvent" BOOLEAN NOT NULL DEFAULT false`
    );
    await ensureColumn(
      "Team",
      "tournamentInstanceId",
      `ALTER TABLE "Team" ADD COLUMN "tournamentInstanceId" INTEGER`
    );
    await ensureColumn(
      "Team",
      "mapBan",
      `ALTER TABLE "Team" ADD COLUMN "mapBan" TEXT`
    );

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Team_teamName_key"
      ON "Team" ("teamName")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Team_importedFromSubmissionId_key"
      ON "Team" ("importedFromSubmissionId")
      WHERE "importedFromSubmissionId" IS NOT NULL
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TeamMember" (
        "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        "teamId" INTEGER NOT NULL,
        "displayName" TEXT NOT NULL,
        "discordUserId" TEXT,
        "embarkId" TEXT,
        "isLeader" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INTEGER NOT NULL DEFAULT 0
      )
    `);

    await ensureColumn(
      "TeamMember",
      "discordUserId",
      `ALTER TABLE "TeamMember" ADD COLUMN "discordUserId" TEXT`
    );
    await ensureColumn(
      "TeamMember",
      "embarkId",
      `ALTER TABLE "TeamMember" ADD COLUMN "embarkId" TEXT`
    );
    await ensureColumn(
      "TeamMember",
      "isLeader",
      `ALTER TABLE "TeamMember" ADD COLUMN "isLeader" BOOLEAN NOT NULL DEFAULT false`
    );
    await ensureColumn(
      "TeamMember",
      "sortOrder",
      `ALTER TABLE "TeamMember" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0`
    );
  });

  await teamTablesReady;
}

function mapTeam(record: any): StoredTeam {
  return {
    id: record.id,
    teamName: record.teamName,
    captainName: record.captainName,
    playerNames: JSON.parse(record.playerNames || "[]") as string[],
    substituteName: record.substituteName,
    discordCommunity: record.discordCommunity,
    approvalStatus: record.approvalStatus,
    checkInStatus: record.checkInStatus,
    leaderDiscordUserId: record.leaderDiscordUserId,
    discordRoleId: record.discordRoleId,
    voiceChannelId: record.voiceChannelId,
    importedFromSubmissionId: record.importedFromSubmissionId,
    isPlacedInEvent: record.isPlacedInEvent,
    tournamentInstanceId: record.tournamentInstanceId,
    mapBan: record.mapBan ?? null,
    members: (record.members ?? []).map((member: any) => ({
      id: member.id,
      teamId: member.teamId,
      displayName: member.displayName,
      discordUserId: member.discordUserId ?? undefined,
      embarkId: member.embarkId ?? undefined,
      isLeader: member.isLeader,
      sortOrder: member.sortOrder,
    })),
  };
}

function buildTeamPayload(submission: StoredRegistrationSubmission) {
  const orderedPlayers = [...submission.players].sort(
    (left, right) => left.sortOrder - right.sortOrder
  );
  const leaderPlayer =
    orderedPlayers.find((player) => player.isLeader) ?? orderedPlayers[0];
  const nonLeaderPlayers = orderedPlayers.filter((player) => !player.isLeader);
  const playerNames = nonLeaderPlayers.slice(0, 3).map((player) => player.displayName);
  const substituteName = nonLeaderPlayers[3]?.displayName ?? "";

  return {
    captainName: leaderPlayer?.displayName ?? submission.leaderDisplayName,
    playerNames: JSON.stringify(playerNames),
    substituteName,
    discordCommunity: submission.discordCommunity,
    approvalStatus: "Approved",
    checkInStatus: "Not Checked In",
    leaderDiscordUserId: submission.leaderDiscordUserId,
    mapBan: submission.mapBan ?? null,
  };
}

async function loadTeamById(id: number): Promise<StoredTeam | null> {
  await ensureTeamTables();
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const team = await prisma.team.findUnique({
    where: { id },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return team ? mapTeam(team) : null;
}

export async function importApprovedRegistrationToTeam(
  submissionId: number,
  actorDiscordUserId: string
): Promise<StoredTeam> {
  await ensureTeamTables();

  const submission = await getRegistrationById(submissionId);

  if (!submission) {
    throw new Error("Submission not found.");
  }

  if (submission.reviewStatus !== "approved") {
    throw new Error("Only approved submissions can be imported.");
  }

  if (submission.importedTeamId) {
    const existingTeam = await loadTeamById(submission.importedTeamId);

    if (existingTeam) {
      return existingTeam;
    }
  }

  const payload = buildTeamPayload(submission);

  const team = await prisma.$transaction(async (tx: any) => {
    const existingBySubmission =
      submission.importedTeamId !== null
        ? await tx.team.findUnique({
            where: { id: submission.importedTeamId },
            include: { members: { orderBy: { sortOrder: "asc" } } },
          })
        : null;

    const existingByName =
      existingBySubmission ??
      (await tx.team.findFirst({
        where: { teamName: submission.teamName },
        include: { members: { orderBy: { sortOrder: "asc" } } },
      }));

    const upserted = existingByName
      ? await tx.team.update({
          where: { id: existingByName.id },
          data: {
            teamName: submission.teamName,
            ...payload,
            importedFromSubmissionId: submission.id,
          },
          include: { members: { orderBy: { sortOrder: "asc" } } },
        })
      : await tx.team.create({
          data: {
            teamName: submission.teamName,
            ...payload,
            importedFromSubmissionId: submission.id,
          },
          include: { members: { orderBy: { sortOrder: "asc" } } },
        });

    await tx.teamMember.deleteMany({
      where: { teamId: upserted.id },
    });

    await tx.teamMember.createMany({
      data: submission.players.map((player) => ({
        teamId: upserted.id,
        displayName: player.displayName,
        discordUserId: player.discordUserId ?? null,
        embarkId: player.embarkId,
        isLeader: player.isLeader,
        sortOrder: player.sortOrder,
      })),
    });

    const refreshed = await tx.team.findUnique({
      where: { id: upserted.id },
      include: { members: { orderBy: { sortOrder: "asc" } } },
    });

    if (!refreshed) {
      throw new Error("Failed to load imported team.");
    }

    return refreshed;
  });

  await markRegistrationImported(submission.id, team.id, actorDiscordUserId);

  await createAuditLog({
    action: "team_imported_from_registration",
    entityType: "team",
    entityId: `${team.id}`,
    summary: `Imported ${team.teamName} into the live team table.`,
    details: `Submission ${submission.id}.${submission.discordCommunity ? ` Community: ${submission.discordCommunity}.` : ""}`,
    actorDiscordUserId,
  });

  return mapTeam(team);
}

export async function listImportedTeams(): Promise<StoredTeam[]> {
  await ensureTeamTables();

  const teams = await prisma.team.findMany({
    where: {
      importedFromSubmissionId: {
        not: null,
      },
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ isPlacedInEvent: "desc" }, { teamName: "asc" }],
  });

  return teams.map(mapTeam);
}

export async function listImportedTeamsForTournamentInstance(
  tournamentInstanceId: number
): Promise<StoredTeam[]> {
  await ensureTeamTables();

  const teams = await prisma.team.findMany({
    where: {
      importedFromSubmissionId: {
        not: null,
      },
      tournamentInstanceId,
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ teamName: "asc" }],
  });

  return teams.map(mapTeam);
}

export async function listUnassignedImportedTeams(): Promise<StoredTeam[]> {
  await ensureTeamTables();

  const teams = await prisma.team.findMany({
    where: {
      importedFromSubmissionId: {
        not: null,
      },
      tournamentInstanceId: null,
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ teamName: "asc" }],
  });

  return teams.map(mapTeam);
}

export async function getPlacedTeams(): Promise<StoredTeam[]> {
  await ensureTeamTables();

  const teams = await prisma.team.findMany({
    where: { isPlacedInEvent: true },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: [{ teamName: "asc" }],
  });

  return teams.map(mapTeam);
}

export async function getTeamById(id: number): Promise<StoredTeam | null> {
  return loadTeamById(id);
}

export async function getTeamBySubmissionId(
  submissionId: number
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const team = await prisma.team.findFirst({
    where: { importedFromSubmissionId: submissionId },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return team ? mapTeam(team) : null;
}

export async function syncImportedTeamFromSubmission(
  submission: StoredRegistrationSubmission,
  actorDiscordUserId: string
): Promise<{
  team: StoredTeam | null;
  updated: boolean;
  teamNameChanged: boolean;
  communityChanged: boolean;
  previousTeamName: string | null;
}> {
  await ensureTeamTables();

  const existingBySubmission = submission.importedTeamId
    ? await loadTeamById(submission.importedTeamId)
    : await getTeamBySubmissionId(submission.id);
  const existingByName = existingBySubmission
    ? null
    : await prisma.team.findFirst({
        where: { teamName: submission.teamName },
        include: {
          members: {
            orderBy: { sortOrder: "asc" },
          },
        },
      });
  const existing = existingBySubmission ?? (existingByName ? mapTeam(existingByName) : null);

  const payload = buildTeamPayload(submission);
  const teamNameChanged = Boolean(existing && existing.teamName !== submission.teamName);
  const communityChanged = Boolean(
    existing &&
      (existing.discordCommunity?.trim() || null) !==
        (submission.discordCommunity?.trim() || null)
  );
  const needsTeamUpdate =
    !existing ||
    teamNameChanged ||
    communityChanged ||
    existing.captainName !== payload.captainName ||
    JSON.stringify(existing.playerNames) !== payload.playerNames ||
    existing.substituteName !== payload.substituteName ||
    existing.leaderDiscordUserId !== payload.leaderDiscordUserId ||
    existing.mapBan !== payload.mapBan ||
    existing.importedFromSubmissionId !== submission.id;

  const existingMembers = existing
    ? existing.members.map((member) => ({
        displayName: member.displayName,
        discordUserId: member.discordUserId ?? null,
        embarkId: member.embarkId ?? null,
        isLeader: member.isLeader,
        sortOrder: member.sortOrder,
      }))
    : [];
  const incomingMembers = submission.players.map((player) => ({
    displayName: player.displayName,
    discordUserId: player.discordUserId ?? null,
    embarkId: player.embarkId,
    isLeader: player.isLeader,
    sortOrder: player.sortOrder,
  }));
  const needsMembersUpdate =
    !existing || JSON.stringify(existingMembers) !== JSON.stringify(incomingMembers);

  const persisted = await prisma.$transaction(async (tx: any) => {
    const upserted = existing
      ? needsTeamUpdate
        ? await tx.team.update({
            where: { id: existing.id },
            data: {
              teamName: submission.teamName,
              ...payload,
              importedFromSubmissionId: submission.id,
            },
            include: {
              members: {
                orderBy: { sortOrder: "asc" },
              },
            },
          })
        : await tx.team.findUniqueOrThrow({
            where: { id: existing.id },
            include: {
              members: {
                orderBy: { sortOrder: "asc" },
              },
            },
          })
      : await tx.team.create({
          data: {
            teamName: submission.teamName,
            ...payload,
            importedFromSubmissionId: submission.id,
          },
          include: {
            members: {
              orderBy: { sortOrder: "asc" },
            },
          },
        });

    if (needsMembersUpdate) {
      await tx.teamMember.deleteMany({
        where: { teamId: upserted.id },
      });
      await tx.teamMember.createMany({
        data: submission.players.map((player) => ({
          teamId: upserted.id,
          displayName: player.displayName,
          discordUserId: player.discordUserId ?? null,
          embarkId: player.embarkId,
          isLeader: player.isLeader,
          sortOrder: player.sortOrder,
        })),
      });
    }

    return tx.team.findUniqueOrThrow({
      where: { id: upserted.id },
      include: {
        members: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  });

  if (!existing || existing.importedFromSubmissionId !== submission.id || submission.importedTeamId !== persisted.id) {
    await markRegistrationImported(submission.id, persisted.id, actorDiscordUserId);
  }

  if (!existing) {
    await createAuditLog({
      action: "team_imported_from_registration",
      entityType: "team",
      entityId: `${persisted.id}`,
      summary: `Imported ${persisted.teamName} into the live team table.`,
      details: `Submission ${submission.id}.${submission.discordCommunity ? ` Community: ${submission.discordCommunity}.` : ""}`,
      actorDiscordUserId,
    });

    return {
      team: mapTeam(persisted),
      updated: true,
      teamNameChanged: false,
      communityChanged: false,
      previousTeamName: null,
    };
  }

  if (!needsTeamUpdate && !needsMembersUpdate) {
    return {
      team: mapTeam(persisted),
      updated: false,
      teamNameChanged: false,
      communityChanged: false,
      previousTeamName: existing.teamName,
    };
  }

  await createAuditLog({
    action: "team_synced_from_sheet",
    entityType: "team",
    entityId: `${persisted.id}`,
    summary: `Synced imported team ${persisted.teamName} from sheet.`,
    details: [
      teamNameChanged ? `Renamed from "${existing.teamName}".` : null,
      communityChanged
        ? `Community changed from "${existing.discordCommunity ?? "none"}" to "${persisted.discordCommunity ?? "none"}".`
        : null,
      needsMembersUpdate ? "Team members refreshed from submission." : null,
      "Tournament instance assignment was preserved.",
    ]
      .filter(Boolean)
      .join(" "),
    actorDiscordUserId,
  });

  return {
    team: mapTeam(persisted),
    updated: true,
    teamNameChanged,
    communityChanged,
    previousTeamName: existing.teamName,
  };
}

export async function setTeamPlacement(
  teamId: number,
  isPlacedInEvent: boolean,
  actorDiscordUserId: string
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      isPlacedInEvent,
      checkInStatus: isPlacedInEvent ? "Not Checked In" : "Not Checked In",
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  await createAuditLog({
    action: isPlacedInEvent ? "team_placed" : "team_removed_from_event",
    entityType: "team",
    entityId: `${teamId}`,
    summary: `${updated.teamName} ${isPlacedInEvent ? "placed into" : "removed from"} event.`,
    actorDiscordUserId,
  });

  return mapTeam(updated);
}

export async function assignTeamToTournamentInstance(
  teamId: number,
  tournamentInstanceId: number | null,
  actorDiscordUserId: string
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      tournamentInstanceId,
      isPlacedInEvent: tournamentInstanceId !== null,
      checkInStatus: "Not Checked In",
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  await createAuditLog({
    action:
      tournamentInstanceId === null
        ? "team_unassigned_from_tournament_instance"
        : "team_assigned_to_tournament_instance",
    entityType: "team",
    entityId: `${teamId}`,
    summary:
      tournamentInstanceId === null
        ? `${updated.teamName} removed from tournament instance.`
        : `${updated.teamName} assigned to tournament instance ${tournamentInstanceId}.`,
    actorDiscordUserId,
  });

  return mapTeam(updated);
}

export async function deleteImportedTeam(
  teamId: number,
  actorDiscordUserId: string
): Promise<{
  teamName: string;
  sheetDeleteAttempted: boolean;
  sheetDeleteSucceeded: boolean;
  sheetDeleteError: string | null;
}> {
  await ensureTeamTables();

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!team) {
    throw new Error("Team not found.");
  }

  if (team.importedFromSubmissionId === null) {
    throw new Error("Only imported teams can be deleted from this panel.");
  }

  const registration = await getRegistrationById(team.importedFromSubmissionId);
  const canDeleteSheetRow = Boolean(
    registration?.sourceSpreadsheetId &&
      registration.sourceWorksheetTitle &&
      registration.sourceRowNumber
  );

  let sheetDeleteSucceeded = false;
  let sheetDeleteError: string | null = null;

  if (registration && canDeleteSheetRow) {
    try {
      await deleteSourceRowFromGoogleSheet(
        registration.sourceSpreadsheetId as string,
        registration.sourceWorksheetTitle as string,
        registration.sourceRowNumber as number
      );
      sheetDeleteSucceeded = true;
    } catch (error) {
      sheetDeleteError = error instanceof Error ? error.message : "Unknown sheet delete error.";
    }
  }

  await prisma.$transaction(async (tx: any) => {
    await tx.teamMember.deleteMany({
      where: { teamId },
    });

    await tx.team.delete({
      where: { id: teamId },
    });
  });

  await clearRegistrationImportedTeam(team.importedFromSubmissionId, actorDiscordUserId);

  await createAuditLog({
    action: "team_deleted_from_admin",
    entityType: "team",
    entityId: `${teamId}`,
    summary: `Deleted imported team ${team.teamName}.`,
    details: canDeleteSheetRow
      ? `Source sheet row delete ${sheetDeleteSucceeded ? "succeeded" : `failed: ${sheetDeleteError ?? "unknown error"}`}.`
      : "No source sheet row metadata was available.",
    actorDiscordUserId,
  });

  return {
    teamName: team.teamName,
    sheetDeleteAttempted: canDeleteSheetRow,
    sheetDeleteSucceeded,
    sheetDeleteError,
  };
}

export async function setTeamCheckInStatus(
  teamId: number,
  checkInStatus: "Checked In" | "Not Checked In",
  actorDiscordUserId: string
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      checkInStatus,
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  await createAuditLog({
    action:
      checkInStatus === "Checked In" ? "team_checked_in" : "team_checkin_cleared",
    entityType: "team",
    entityId: `${teamId}`,
    summary: `${updated.teamName} marked ${checkInStatus}.`,
    actorDiscordUserId,
  });

  return mapTeam(updated);
}

export async function updateTeamDiscordAssets(
  teamId: number,
  roleId: string | null,
  voiceChannelId: string | null,
  actorDiscordUserId: string
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: {
      discordRoleId: roleId,
      voiceChannelId,
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  await createAuditLog({
    action: "team_discord_assets_updated",
    entityType: "team",
    entityId: `${teamId}`,
    summary: `Updated Discord assets for ${updated.teamName}.`,
    details: `Role ${roleId ?? "none"}, voice ${voiceChannelId ?? "none"}.`,
    actorDiscordUserId,
  });

  return mapTeam(updated);
}

export async function getTeamByTournamentInstanceAndName(
  tournamentInstanceId: number,
  teamName: string
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const team = await prisma.team.findFirst({
    where: {
      tournamentInstanceId,
      teamName,
    },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return team ? mapTeam(team) : null;
}

export async function getTeamForUser(
  userId: string,
  memberRoles?: GuildMemberRoleManager
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const roleIds = memberRoles ? new Set(memberRoles.cache.keys()) : new Set<string>();

  const byLeader = await prisma.team.findFirst({
    where: {
      OR: [
        { leaderDiscordUserId: userId },
        {
          members: {
            some: {
              discordUserId: userId,
            },
          },
        },
      ],
    },
    orderBy: [{ tournamentInstanceId: "desc" }, { id: "desc" }],
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (byLeader) {
    return mapTeam(byLeader);
  }

  if (roleIds.size === 0) {
    return null;
  }

  const roleMatchedTeam = await prisma.team.findFirst({
    where: {
      discordRoleId: {
        in: Array.from(roleIds),
      },
    },
    orderBy: [{ tournamentInstanceId: "desc" }, { id: "desc" }],
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return roleMatchedTeam ? mapTeam(roleMatchedTeam) : null;
}

export async function getTeamForUserInTournament(
  userId: string,
  tournamentInstanceId: number,
  memberRoles?: GuildMemberRoleManager
): Promise<StoredTeam | null> {
  await ensureTeamTables();

  const roleIds = memberRoles ? Array.from(memberRoles.cache.keys()) : [];
  const accessClauses: Array<Record<string, unknown>> = [
    { leaderDiscordUserId: userId },
    {
      members: {
        some: {
          discordUserId: userId,
        },
      },
    },
  ];

  if (roleIds.length > 0) {
    accessClauses.push({
      discordRoleId: {
        in: roleIds,
      },
    });
  }

  const team = await prisma.team.findFirst({
    where: {
      tournamentInstanceId,
      OR: accessClauses,
    },
    orderBy: { id: "desc" },
    include: {
      members: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  return team ? mapTeam(team) : null;
}
