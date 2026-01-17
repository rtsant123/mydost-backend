import { prisma } from "@mydost/db";

export const generateMatchBrief = async (matchId: string) => {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) {
    throw new Error("Match not found");
  }
  const brief = {
    headline: `${match.teamA} vs ${match.teamB}`,
    notes: ["Form guide pending", "Weather check pending"],
    updatedAt: new Date().toISOString()
  };
  const latestVersion = await prisma.matchBrief.findFirst({
    where: { matchId },
    orderBy: { version: "desc" }
  });
  const version = latestVersion ? latestVersion.version + 1 : 1;
  return prisma.matchBrief.create({
    data: {
      matchId,
      version,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8),
      sourcesJson: ["internal"],
      briefJson: brief
    }
  });
};

export const generateMatchRecap = async (matchId: string) => {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) {
    throw new Error("Match not found");
  }
  const recap = {
    headline: `${match.teamA} vs ${match.teamB} recap`,
    summary: "Recap generation pending",
    updatedAt: new Date().toISOString()
  };
  return prisma.matchRecap.create({
    data: {
      matchId,
      sourcesJson: ["internal"],
      recapJson: recap
    }
  });
};
