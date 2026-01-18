import { FastifyInstance } from "fastify";
import { prisma } from "@mydost/db";
import { chatMessageSchema, chatStartSchema, cardResponseSchema, defaultCardResponse } from "@mydost/shared";
import { createClaudeProvider, createSearchProvider } from "../services/llm";
import { buildMarketsContext } from "../services/markets";
import { cacheGetJson } from "../services/cache";
import { incrementUsage, getUsage } from "../services/usage";
import { planConfig } from "../services/plans";

export const registerChatRoutes = (app: FastifyInstance) => {
  const llmProvider = createClaudeProvider(app.env.CLAUDE_API_KEY);
  const searchProvider = createSearchProvider(app.redis, app.env.SERPER_API_KEY);
  const memoryTtlSeconds = 60 * 60 * 24 * 7;
  const memoryMaxItems = 12;
  const formatIst = (date: Date) =>
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  const istRangeForOffset = (offsetDays: number) => {
    const now = new Date();
    const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
    const dateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(target);
    return {
      label: dateStr,
      start: new Date(`${dateStr}T00:00:00+05:30`),
      end: new Date(`${dateStr}T23:59:59+05:30`)
    };
  };

  const extractCardText = (cards: Array<{ title?: string; content?: string; bullets?: string[] }>) => {
    const parts: string[] = [];
    for (const card of cards) {
      if (card.title) parts.push(card.title);
      if (card.content) parts.push(card.content);
      if (card.bullets?.length) parts.push(...card.bullets);
    }
    return parts.map((item) => item.trim()).filter(Boolean).join("\n");
  };

  const maybeAddMatchList = async (message: string, contextChunks: string[]) => {
    const wantsToday = /\b(today|tonight|aaj|aj)\b/i.test(message);
    const wantsTomorrow = /\b(tomorrow|kal)\b/i.test(message);
    if (!wantsToday && !wantsTomorrow) return;

    const sports: string[] = [];
    if (/(football|soccer)/i.test(message)) sports.push("football");
    if (/cricket/i.test(message)) sports.push("cricket");

    const ranges = [wantsToday ? istRangeForOffset(0) : null, wantsTomorrow ? istRangeForOffset(1) : null].filter(
      Boolean
    ) as Array<{ label: string; start: Date; end: Date }>;

    for (const range of ranges) {
      const matches = await prisma.match.findMany({
        where: {
          startTime: { gte: range.start, lte: range.end },
          ...(sports.length ? { sport: { in: sports } } : {})
        },
        orderBy: { startTime: "asc" },
        take: 30
      });
      if (!matches.length) continue;
      const lines = matches.map(
        (match) =>
          `${match.teamA} vs ${match.teamB} (${match.league}) - ${formatIst(match.startTime)} [${match.status}]`
      );
      contextChunks.push(`Upcoming matches (${range.label} IST):\n${lines.join("\n")}`);
    }
  };

  app.get("/api/chat/stream", async (request, reply) => {
    const query = request.query as { q?: string; topic?: string; matchId?: string; language?: string };
    const userMessage = query.q?.trim();
    if (!userMessage) {
      return reply.status(400).send({ error: "Missing q" });
    }

    const contextChunks: string[] = [];
    const topic = query.topic ?? "general";

    if (topic === "sports" && query.matchId) {
      const brief = await cacheGetJson(app.redis, `match:brief:${query.matchId}:current`);
      if (brief) contextChunks.push(`Match brief: ${JSON.stringify(brief)}`);
      const recap = await cacheGetJson(app.redis, `match:recap:${query.matchId}:current`);
      if (recap) contextChunks.push(`Match recap: ${JSON.stringify(recap)}`);
    }

    if (topic === "teer" && query.matchId) {
      const summary = await cacheGetJson(app.redis, `teer:summary:${query.matchId}:30`);
      if (summary) contextChunks.push(`Teer summary: ${JSON.stringify(summary)}`);
    }

    await maybeAddMatchList(userMessage, contextChunks);

    const isMarketsQuery = /\b(market|markets|stock|stocks|share|nse|bse|sensex|nifty|crypto|bitcoin|btc|eth|solana|price)\b/i.test(
      userMessage
    );
    if (topic === "markets" || isMarketsQuery) {
      const marketsContext = await buildMarketsContext(app.redis, app.env);
      if (marketsContext) contextChunks.push(marketsContext);
    }

    const isSportsQuery = /\b(match|vs|fixture|prediction|odds|score|lineup|h2h|head to head|head-to-head|standings|table|result|schedule|today|tomorrow)\b/i.test(
      userMessage
    );
    const ragSnippets = isSportsQuery ? await searchProvider.search(userMessage) : [];
    if (ragSnippets.length) {
      contextChunks.push(`RAG snippets: ${ragSnippets.join("\n")}`);
    }

    const llmInput = {
      userMessage,
      language: (query.language as any) ?? "hinglish",
      context: contextChunks.join("\n\n"),
      maxTokens: 350,
      responseStyle: "short"
    };

    const response = await llmProvider.generateCards(llmInput);
    const validated = cardResponseSchema.safeParse(response);
    const cardResponse = validated.success ? validated.data : defaultCardResponse(llmInput.language);

    const origin = request.headers.origin ?? "*";
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      Vary: "Origin"
    });
    reply.raw.write(`data: ${JSON.stringify({ card: cardResponse })}\n\n`);
    reply.raw.write("data: {\"done\":true}\n\n");
    reply.raw.end();
  });

  app.post("/api/chat/start", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = request.user as { sub: string };
    const parsed = chatStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const session = await prisma.chatSession.create({
      data: {
        userId: payload.sub,
        topic: parsed.data.topic,
        refId: parsed.data.refId
      }
    });
    return reply.status(201).send(session);
  });

  app.post("/api/chat/message", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const payload = request.user as { sub: string };
    const parsed = chatMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }

    const prefs = await prisma.userPrefs.findUnique({ where: { userId: payload.sub } });
    const plan = planConfig[user.plan as keyof typeof planConfig];
    const usage = await getUsage(payload.sub);
    if (plan.dailyMessages !== "unlimited" && usage.messageCount >= plan.dailyMessages) {
      return reply.status(429).send({ error: "Daily message limit reached" });
    }

    const session = await prisma.chatSession.findUnique({ where: { id: parsed.data.sessionId } });
    if (!session || session.userId !== payload.sub) {
      return reply.status(404).send({ error: "Session not found" });
    }

    const recentMessages = await prisma.chatMessage.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: 3
    });

    const contextChunks: string[] = [];
    const memoryKey = `memory:${payload.sub}:${session.topic}`;
    const memoryRaw = await app.redis.get(memoryKey);
    if (memoryRaw) {
      try {
        const memoryItems = JSON.parse(memoryRaw) as string[];
        if (memoryItems.length) {
          contextChunks.push(`Memory:\n${memoryItems.join("\n")}`);
        }
      } catch (error) {
        // ignore corrupted memory
      }
    }

    if (session.topic === "sports" && session.refId) {
      const brief = await cacheGetJson(app.redis, `match:brief:${session.refId}:current`);
      if (brief) contextChunks.push(`Match brief: ${JSON.stringify(brief)}`);
      const recap = await cacheGetJson(app.redis, `match:recap:${session.refId}:current`);
      if (recap) contextChunks.push(`Match recap: ${JSON.stringify(recap)}`);
    }

    if (session.topic === "teer" && session.refId) {
      const summary = await cacheGetJson(app.redis, `teer:summary:${session.refId}:30`);
      if (summary) contextChunks.push(`Teer summary: ${JSON.stringify(summary)}`);
    }

    await maybeAddMatchList(parsed.data.message, contextChunks);

    const isMarketsQuery = /\b(market|markets|stock|stocks|share|nse|bse|sensex|nifty|crypto|bitcoin|btc|eth|solana|price)\b/i.test(
      parsed.data.message
    );
    if (session.topic === "markets" || isMarketsQuery) {
      const marketsContext = await buildMarketsContext(app.redis, app.env);
      if (marketsContext) contextChunks.push(marketsContext);
    }

    const isSportsQuery = /\b(match|vs|fixture|prediction|odds|score|lineup|h2h|head to head|head-to-head|standings|table|result|schedule|today|tomorrow)\b/i.test(
      parsed.data.message
    );
    const ragSnippets = isSportsQuery ? await searchProvider.search(parsed.data.message) : [];
    if (ragSnippets.length) {
      contextChunks.push(`RAG snippets: ${ragSnippets.join("\n")}`);
    }

    if (prefs) {
      contextChunks.push(`User prefs: ${JSON.stringify(prefs)}`);
    }

    if (recentMessages.length) {
      const history = recentMessages.reverse().map((msg) => `${msg.role}: ${msg.content}`);
      contextChunks.push(`History:\n${history.join("\n")}`);
    }

    const responseStyle = usage.messageCount > 20 ? "short" : (prefs?.responseStyle ?? "short");
    const llmInput = {
      userMessage: parsed.data.message,
      language: (prefs?.language as any) ?? "hinglish",
      context: contextChunks.join("\n\n"),
      maxTokens: plan.maxTokens,
      responseStyle
    };

    const response = await llmProvider.generateCards(llmInput);
    const validated = cardResponseSchema.safeParse(response);
    const cardResponse = validated.success ? validated.data : defaultCardResponse(llmInput.language);

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "user",
        content: parsed.data.message,
        tokenEstimate: parsed.data.message.length
      }
    });

    await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: JSON.stringify(cardResponse),
        cardsJson: cardResponse as any,
        tokenEstimate: JSON.stringify(cardResponse).length
      }
    });

    const assistantText = extractCardText(cardResponse.cards as any);
    const memoryUpdate = [`user: ${parsed.data.message}`, `assistant: ${assistantText}`];
    if (memoryUpdate.length) {
      let existing: string[] = [];
      if (memoryRaw) {
        try {
          existing = JSON.parse(memoryRaw) as string[];
        } catch (error) {
          existing = [];
        }
      }
      const next = [...existing, ...memoryUpdate].slice(-memoryMaxItems);
      await app.redis.set(memoryKey, JSON.stringify(next), "EX", memoryTtlSeconds);
    }

    const metric = await incrementUsage(payload.sub);
    await app.redis.set(`usage:${payload.sub}:${metric.dateKey}`, JSON.stringify(metric), "EX", 60 * 60 * 24);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    reply.raw.write(`data: ${JSON.stringify(cardResponse)}\n\n`);
    reply.raw.end();
  });
};
