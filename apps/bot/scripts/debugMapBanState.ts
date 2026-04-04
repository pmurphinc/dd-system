import { prisma } from "../storage/prisma";

async function main() {
  const explicitInstanceId = process.env.INSTANCE_ID
    ? Number(process.env.INSTANCE_ID)
    : null;
  const guildId = process.env.DISCORD_GUILD_ID?.trim() || null;

  const instance = explicitInstanceId
    ? await prisma.tournamentInstance.findUnique({
        where: { id: explicitInstanceId },
      })
    : await prisma.tournamentInstance.findFirst({
        where: guildId ? { guildId } : undefined,
        orderBy: [{ updatedAt: "desc" }],
      });

  if (!instance) {
    console.log("[map-ban-debug] no tournament instance found.");
    return;
  }

  const teams = await prisma.team.findMany({
    where: {
      tournamentInstanceId: instance.id,
      importedFromSubmissionId: {
        not: null,
      },
    },
    orderBy: [{ teamName: "asc" }],
  });

  console.log(
    `[map-ban-debug] instance=${instance.id} name=${instance.name} stage=${instance.currentStage} cycle=${instance.currentCycle ?? "-"} teams=${teams.length}`
  );

  for (const team of teams) {
    const submission =
      team.importedFromSubmissionId === null
        ? null
        : await prisma.registrationSubmission.findUnique({
            where: { id: team.importedFromSubmissionId },
          });

    console.log(
      `[map-ban-debug] submissionTeam=${submission?.teamName ?? "<missing_submission>"} submission.mapBan=${submission?.mapBan ?? "<null>"} team=${team.teamName} team.mapBan=${team.mapBan ?? "<null>"} submissionId=${team.importedFromSubmissionId ?? "<null>"}`
    );
  }
}

main()
  .catch((error) => {
    console.error("[map-ban-debug] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
