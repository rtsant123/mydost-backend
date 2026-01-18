import { prisma } from "@mydost/db";
import { Redis } from "ioredis";
import { fetchEventsDay, toMatchData } from "./providers/sportsdb";

const formatIstDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);

export const refreshMatchBriefs = async (redis: Redis) => {
  const matches = await prisma.match.findMany({
    where: { status: { in: ["scheduled", "live"] } }
  });

  for (const match of matches) {
    const brief = {
      matchId: match.id,
      headline: `${match.teamA} vs ${match.teamB}`,
      notes: ["Auto-refresh brief"],
      updatedAt: new Date().toISOString()
    };
    const existing = await prisma.matchBrief.findFirst({
      where: { matchId: match.id },
      orderBy: { version: "desc" }
    });
    const version = existing ? existing.version + 1 : 1;
    const record = await prisma.matchBrief.create({
      data: {
        matchId: match.id,
        version,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 8),
        sourcesJson: ["worker"],
        briefJson: brief
      }
    });
    await redis.set(`match:brief:${match.id}:current`, JSON.stringify(record), "EX", 60 * 60 * 8);
    await redis.set(`match:brief:${match.id}:v${record.version}`, JSON.stringify(record), "EX", 60 * 60 * 8);
  }
};

export const refreshTeerSummaries = async (redis: Redis) => {
  const houses = await prisma.teerResult.findMany({
    distinct: ["house"],
    select: { house: true }
  });

  for (const { house } of houses) {
    const summary = {
      house,
      windowDays: 30,
      notes: ["Auto-refresh summary"],
      updatedAt: new Date().toISOString()
    };
    const record = await prisma.teerSummary.upsert({
      where: { house_windowDays: { house, windowDays: 30 } },
      create: { house, windowDays: 30, summaryJson: summary },
      update: { summaryJson: summary }
    });
    await redis.set(`teer:summary:${house}:30`, JSON.stringify(record), "EX", 60 * 60 * 6);
  }
};

export const generateMatchRecaps = async (redis: Redis) => {
  const matches = await prisma.match.findMany({ where: { status: "finished" } });
  for (const match of matches) {
    const existing = await prisma.matchRecap.findFirst({ where: { matchId: match.id } });
    if (existing) continue;
    const recap = {
      matchId: match.id,
      headline: `${match.teamA} vs ${match.teamB} recap`,
      summary: "Auto recap pending",
      updatedAt: new Date().toISOString()
    };
    const record = await prisma.matchRecap.create({
      data: { matchId: match.id, sourcesJson: ["worker"], recapJson: recap }
    });
    await redis.set(`match:recap:${match.id}:current`, JSON.stringify(record), "EX", 60 * 60 * 12);
  }
};

export const syncSportsFixtures = async (apiKey?: string) => {
  if (!apiKey) return;

  const today = new Date();
  const dates = [0, 1].map((offset) => {
    const target = new Date(today.getTime() + offset * 24 * 60 * 60 * 1000);
    return formatIstDate(target);
  });

  const sports = [
    { sport: "football", apiSport: "Soccer" },
    { sport: "cricket", apiSport: "Cricket" }
  ];

  for (const date of dates) {
    for (const { sport, apiSport } of sports) {
      const events = await fetchEventsDay(apiKey, date, apiSport);
      for (const event of events) {
        const matchData = toMatchData(event);
        if (!matchData?.sourceId) continue;
        await prisma.match.upsert({
          where: { source_sourceId: { source: matchData.source, sourceId: matchData.sourceId } },
          create: {
            sport,
            league: matchData.league,
            teamA: matchData.teamA,
            teamB: matchData.teamB,
            startTime: matchData.startTime,
            status: matchData.status,
            source: matchData.source,
            sourceId: matchData.sourceId,
            venue: matchData.venue,
            scoreA: matchData.scoreA,
            scoreB: matchData.scoreB,
            statusText: matchData.statusText,
            metaJson: matchData.metaJson
          },
          update: {
            league: matchData.league,
            teamA: matchData.teamA,
            teamB: matchData.teamB,
            startTime: matchData.startTime,
            status: matchData.status,
            venue: matchData.venue,
            scoreA: matchData.scoreA,
            scoreB: matchData.scoreB,
            statusText: matchData.statusText,
            metaJson: matchData.metaJson
          }
        });
      }
    }
  }
};
