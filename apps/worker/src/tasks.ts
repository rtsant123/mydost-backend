import { prisma } from "@mydost/db";
import { Redis } from "ioredis";
import crypto from "crypto";
import { Env } from "./config";
import { fetchEventsDay, toMatchData } from "./providers/sportsdb";

const formatIstDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);

const stocksKey = (symbols: string[]) => `markets:stocks:${symbols.join(",")}`;
const searchKey = (query: string) => `search:${hashKey(query.toLowerCase())}`;
const STOCKS_INTRADAY_INTERVAL = "5min";
const STOCKS_CACHE_TTL_SECONDS = 60 * 60 * 24;
const RAG_MAX_SNIPPETS = 6;
const RAG_MAX_SNIPPET_CHARS = 360;

const parseList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const hashKey = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

const formatSigned = (value: number, decimals = 2) => {
  const fixed = value.toFixed(decimals);
  return value > 0 ? `+${fixed}` : fixed;
};

const parseIntradayQuote = (payload: Record<string, unknown>, interval: string) => {
  const seriesKey = `Time Series (${interval})`;
  const series = payload[seriesKey] as Record<string, Record<string, string>> | undefined;
  if (!series) return null;
  const timestamps = Object.keys(series);
  if (!timestamps.length) return null;
  timestamps.sort((a, b) => (a < b ? 1 : -1));
  const latest = series[timestamps[0]];
  const previous = series[timestamps[1]];
  const latestCloseRaw = latest?.["4. close"];
  if (!latestCloseRaw) return null;
  const latestClose = Number(latestCloseRaw);
  if (!Number.isFinite(latestClose)) return null;
  const previousCloseRaw = previous?.["4. close"];
  const previousClose = previousCloseRaw ? Number(previousCloseRaw) : null;

  let change: number | null = null;
  let changePercent: number | null = null;
  if (previousClose !== null && Number.isFinite(previousClose) && previousClose !== 0) {
    change = latestClose - previousClose;
    changePercent = (change / previousClose) * 100;
  }

  return {
    price: latestClose,
    change,
    changePercent
  };
};

const fetchStockSnapshot = async (redis: Redis, env: Env) => {
  const apiKey = env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) return [];
  const symbols = parseList(env.MARKET_STOCK_SYMBOLS).map((symbol) => symbol.toUpperCase());
  const cacheKey = stocksKey(symbols);
  const cachedRaw = await redis.get(cacheKey);
  let cached: Array<{ symbol: string; price: string | null; change?: string | null; changePercent?: string | null }> | null =
    null;
  if (cachedRaw) {
    try {
      cached = JSON.parse(cachedRaw) as Array<{
        symbol: string;
        price: string | null;
        change?: string | null;
        changePercent?: string | null;
      }>;
    } catch (error) {
      cached = null;
    }
  }

  const results: Array<{ symbol: string; price: string | null; change: string | null; changePercent: string | null }> =
    [];

  for (const symbol of symbols) {
    const url = new URL("https://www.alphavantage.co/query");
    url.searchParams.set("function", "TIME_SERIES_INTRADAY");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", STOCKS_INTRADAY_INTERVAL);
    url.searchParams.set("outputsize", "compact");
    url.searchParams.set("apikey", apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      results.push({ symbol, price: null, change: null, changePercent: null });
      continue;
    }
    const payload = (await response.json()) as Record<string, unknown>;
    if (payload["Note"] || payload["Error Message"] || payload["Information"]) {
      results.push({ symbol, price: null, change: null, changePercent: null });
      continue;
    }
    const quote = parseIntradayQuote(payload, STOCKS_INTRADAY_INTERVAL);
    if (!quote) {
      results.push({ symbol, price: null, change: null, changePercent: null });
      continue;
    }
    results.push({
      symbol,
      price: quote.price.toFixed(2),
      change: quote.change !== null ? formatSigned(quote.change) : null,
      changePercent: quote.changePercent !== null ? `${formatSigned(quote.changePercent)}%` : null
    });
  }

  const shouldFallbackToCache = cached && results.every((row) => row.price === null);
  if (shouldFallbackToCache) {
    return cached;
  }

  await redis.set(cacheKey, JSON.stringify(results), "EX", STOCKS_CACHE_TTL_SECONDS);
  return results;
};

const fetchSearchSnippets = async (query: string, apiKey: string) => {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ q: query })
  });

  if (!response.ok) return [];

  const payload = (await response.json()) as {
    organic?: Array<{ title?: string; snippet?: string; link?: string }>;
  };

  const snippets =
    payload.organic
      ?.map((item) => [item.title, item.snippet, item.link].filter(Boolean).join(" - "))
      .filter(Boolean) ?? [];

  return snippets
    .map((item) => (item.length > RAG_MAX_SNIPPET_CHARS ? item.slice(0, RAG_MAX_SNIPPET_CHARS) : item))
    .slice(0, RAG_MAX_SNIPPETS);
};

const buildMatchQueries = (match: { teamA: string; teamB: string }) => {
  const matchName = `${match.teamA} vs ${match.teamB}`;
  return [
    `${matchName} probable XI`,
    `${matchName} head to head`,
    `${matchName} playing 11`,
    `${matchName} pitch report`
  ];
};

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

export const refreshMarketSnapshots = async (redis: Redis, env: Env) => {
  await fetchStockSnapshot(redis, env);
};

export const refreshSportsRagCache = async (redis: Redis, env: Env) => {
  const apiKey = env.SERPER_API_KEY;
  if (!apiKey) return;

  const now = new Date();
  const end = new Date(now.getTime() + env.RAG_PREFETCH_DAYS * 24 * 60 * 60 * 1000);

  const matches = await prisma.match.findMany({
    where: {
      status: { in: ["scheduled", "live"] },
      startTime: { gte: now, lte: end }
    },
    orderBy: { startTime: "asc" },
    take: env.RAG_PREFETCH_MATCH_LIMIT
  });

  for (const match of matches) {
    const queries = buildMatchQueries(match);
    for (const query of queries) {
      const snippets = await fetchSearchSnippets(query, apiKey);
      if (!snippets.length) continue;
      await redis.set(searchKey(query), JSON.stringify(snippets), "EX", env.SEARCH_CACHE_TTL_SECONDS);
    }
  }
};
