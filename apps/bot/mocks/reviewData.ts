import { prisma } from "../storage/prisma";

export interface MockPendingTeam {
  teamName: string;
  captainName: string;
  playerNames: string[];
  substituteName: string;
  proofStatus: string;
}

export interface MockApprovedTeam extends MockPendingTeam {
  approvalNotes: string;
}

export interface MockDeniedTeam extends MockPendingTeam {
  denialReason: string;
}

export interface MockReviewData {
  pendingTeamsCount: number;
  approvedTeamsCount: number;
  deniedTeamsCount: number;
  currentPendingTeam: MockPendingTeam | null;
  approvedTeams: MockApprovedTeam[];
  deniedTeams: MockDeniedTeam[];
}

const defaultPendingTeam: MockPendingTeam = {
  teamName: "Development Division Echo",
  captainName: "Captain Reyes",
  playerNames: ["Player Alpha", "Player Beta", "Player Gamma"],
  substituteName: "Player Delta",
  proofStatus: "Roster proof uploaded and awaiting admin review.",
};

const defaultReviewData: MockReviewData = {
  pendingTeamsCount: 1,
  approvedTeamsCount: 2,
  deniedTeamsCount: 0,
  currentPendingTeam: defaultPendingTeam,
  approvedTeams: [],
  deniedTeams: [],
};

let reviewStateTableReady: Promise<void> | undefined;

function cloneDefaultReviewData(): MockReviewData {
  return {
    ...defaultReviewData,
    currentPendingTeam: defaultReviewData.currentPendingTeam
      ? { ...defaultReviewData.currentPendingTeam }
      : null,
    approvedTeams: [...defaultReviewData.approvedTeams],
    deniedTeams: [...defaultReviewData.deniedTeams],
  };
}

function serializeReviewData(reviewData: MockReviewData) {
  return {
    pendingTeamsCount: reviewData.pendingTeamsCount,
    approvedTeamsCount: reviewData.approvedTeamsCount,
    deniedTeamsCount: reviewData.deniedTeamsCount,
    currentPendingTeam: reviewData.currentPendingTeam
      ? JSON.stringify(reviewData.currentPendingTeam)
      : null,
    approvedTeams: JSON.stringify(reviewData.approvedTeams),
    deniedTeams: JSON.stringify(reviewData.deniedTeams),
  };
}

function mapReviewData(record: {
  pendingTeamsCount: number;
  approvedTeamsCount: number;
  deniedTeamsCount: number;
  currentPendingTeam: string | null;
  approvedTeams: string;
  deniedTeams: string;
}): MockReviewData {
  return {
    pendingTeamsCount: record.pendingTeamsCount,
    approvedTeamsCount: record.approvedTeamsCount,
    deniedTeamsCount: record.deniedTeamsCount,
    currentPendingTeam: record.currentPendingTeam
      ? (JSON.parse(record.currentPendingTeam) as MockPendingTeam)
      : null,
    approvedTeams: JSON.parse(record.approvedTeams) as MockApprovedTeam[],
    deniedTeams: JSON.parse(record.deniedTeams) as MockDeniedTeam[],
  };
}

async function ensureReviewStateTable(): Promise<void> {
  reviewStateTableReady ??= prisma
    .$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ReviewState" (
        "id" INTEGER NOT NULL PRIMARY KEY,
        "pendingTeamsCount" INTEGER NOT NULL,
        "approvedTeamsCount" INTEGER NOT NULL,
        "deniedTeamsCount" INTEGER NOT NULL,
        "currentPendingTeam" TEXT,
        "approvedTeams" TEXT NOT NULL,
        "deniedTeams" TEXT NOT NULL
      )
    `)
    .then(() => undefined);

  await reviewStateTableReady;
}

async function ensureReviewState(): Promise<MockReviewData> {
  await ensureReviewStateTable();

  const defaultState = cloneDefaultReviewData();
  const record = await prisma.reviewState.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      ...serializeReviewData(defaultState),
    },
  });

  return mapReviewData(record);
}

export async function getMockReviewData(): Promise<MockReviewData> {
  return ensureReviewState();
}

export async function approveCurrentPendingTeam(
  approvalNotes: string
): Promise<MockReviewData> {
  const reviewData = await ensureReviewState();

  if (!reviewData.currentPendingTeam) {
    return reviewData;
  }

  const approvedTeam: MockApprovedTeam = {
    ...reviewData.currentPendingTeam,
    approvalNotes,
  };

  const updatedReviewData: MockReviewData = {
    ...reviewData,
    currentPendingTeam: null,
    pendingTeamsCount: Math.max(0, reviewData.pendingTeamsCount - 1),
    approvedTeamsCount: reviewData.approvedTeamsCount + 1,
    approvedTeams: [...reviewData.approvedTeams, approvedTeam],
  };

  const record = await prisma.reviewState.update({
    where: { id: 1 },
    data: serializeReviewData(updatedReviewData),
  });

  return mapReviewData(record);
}

export async function denyCurrentPendingTeam(): Promise<MockReviewData> {
  const reviewData = await ensureReviewState();

  if (!reviewData.currentPendingTeam) {
    return reviewData;
  }

  const deniedTeam: MockDeniedTeam = {
    ...reviewData.currentPendingTeam,
    denialReason: "Denied by admin during review.",
  };

  const updatedReviewData: MockReviewData = {
    ...reviewData,
    currentPendingTeam: null,
    pendingTeamsCount: Math.max(0, reviewData.pendingTeamsCount - 1),
    deniedTeamsCount: reviewData.deniedTeamsCount + 1,
    deniedTeams: [...reviewData.deniedTeams, deniedTeam],
  };

  const record = await prisma.reviewState.update({
    where: { id: 1 },
    data: serializeReviewData(updatedReviewData),
  });

  return mapReviewData(record);
}

export async function resetMockReviewData(): Promise<MockReviewData> {
  await ensureReviewStateTable();

  const defaultState = cloneDefaultReviewData();
  const record = await prisma.reviewState.upsert({
    where: { id: 1 },
    update: serializeReviewData(defaultState),
    create: {
      id: 1,
      ...serializeReviewData(defaultState),
    },
  });

  return mapReviewData(record);
}
