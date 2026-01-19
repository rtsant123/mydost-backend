import { FastifyInstance } from "fastify";
import { prisma } from "@mydost/db";
import { chatMessageSchema, chatStartSchema, cardResponseSchema, defaultCardResponse } from "@mydost/shared";
import { createClaudeProvider, createSearchProvider } from "../services/llm";
import { buildMarketsContext } from "../services/markets";
import { cacheGetJson } from "../services/cache";
import { incrementUsage, getUsage } from "../services/usage";
import { planConfig } from "../services/plans";

export const registerChatRoutes = (app: FastifyInstance) => {
  const llmProvider = createClaudeProvider(app.env.CLAUDE_API_KEY, {
    model: app.env.CLAUDE_MODEL,
    maxInputChars: app.env.LLM_MAX_INPUT_CHARS,
    maxContextChars: app.env.LLM_MAX_CONTEXT_CHARS
  });
  const searchProvider = createSearchProvider(app.redis, app.env.SERPER_API_KEY, {
    cacheTtlSeconds: app.env.SEARCH_CACHE_TTL_SECONDS,
    maxSnippets: app.env.LLM_MAX_SEARCH_SNIPPETS,
    maxSnippetChars: app.env.LLM_MAX_SEARCH_CHARS
  });
  const memoryTtlSeconds = 60 * 60 * 24 * 7;
  const memoryMaxItems = 12;
  const formatIst = (date: Date) =>
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);

  const chatModel = app.env.CLAUDE_MODEL_CHAT ?? app.env.CLAUDE_MODEL ?? "claude-3-5-haiku-20241022";
  const analysisModel = app.env.CLAUDE_MODEL_ANALYSIS ?? app.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";
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

  const toTextCardResponse = (text: string, language: any) => ({
    cards: [
      {
        type: "answer" as const,
        title: "Response",
        confidence: 60,
        bullets: [text.trim() || "Not available."]
      }
    ],
    disclaimer: defaultCardResponse(language).disclaimer
  });

  const buildMatchContext = async (matchId?: string) => {
    if (!matchId) return null;
    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return null;
    const lines = [
      `Match: ${match.teamA} vs ${match.teamB}`,
      `League: ${match.league}`,
      `Start time (IST): ${formatIst(match.startTime)}`,
      `Status: ${match.status}${match.statusText ? ` (${match.statusText})` : ""}`,
      match.venue ? `Venue: ${match.venue}` : ""
    ].filter(Boolean);
    return { match, text: `Match details:\n${lines.join("\n")}` };
  };

  const buildSportsSearchQueries = (message: string, matchName?: string) => {
    const queries: string[] = [];
    const pushUnique = (query: string) => {
      if (!query || queries.includes(query)) return;
      queries.push(query);
    };

    const normalized = message.trim();
    if (matchName) {
      pushUnique(`${matchName} live score`);
      pushUnique(`${matchName} latest updates`);
    }
    if (normalized) pushUnique(normalized);

    return queries.slice(0, 2);
  };

  const analysisKeywords =
    /\b(analysis|analyze|compare|vs|stats?|statistics|table|summary|insight|prediction|forecast|h2h|head\s*to\s*head|fixture|fixtures|schedule|matches|list)\b/i;

  const isSmallTalk = (message: string) =>
    /^\s*(hi|hello|hey|thanks|thank you|ok|okay|cool|nice|bye|good morning|good night|how are you)\b/i.test(
      message
    );

  const cannedSmallTalk = (message: string) => {
    const normalized = message.trim().toLowerCase();
    if (/^(hi|hello|hey)\b/.test(normalized)) return "Hi! How can I help?";
    if (/^how are you\b/.test(normalized)) return "I’m good — how are you?";
    if (/^(thanks|thank you)\b/.test(normalized)) return "You’re welcome! Need anything else?";
    if (/^(bye|good night)\b/.test(normalized)) return "Bye! Come back anytime.";
    if (/^good morning\b/.test(normalized)) return "Good morning! How can I help today?";
    if (/^(ok|okay|cool|nice)\b/.test(normalized)) return "Got it. Anything else you need?";
    return null;
  };

  const decideResponseMode = (topic: string, message: string) => {
    if (isSmallTalk(message)) return "text" as const;
    if (topic === "dost") return "text" as const;
    if (analysisKeywords.test(message)) return "cards" as const;
    if (topic === "sports" && /\b(match|matches|fixtures|schedule|today|tomorrow|tonight)\b/i.test(message)) {
      return "cards" as const;
    }
    if (topic === "markets" && /\b(price|rate|list|change|market)\b/i.test(message)) {
      return "cards" as const;
    }
    if (topic === "teer" && /\b(summary|history|result|prediction)\b/i.test(message)) {
      return "cards" as const;
    }
    if (topic === "astrology" && /\b(horoscope|kundli|rashi|lagna|prediction)\b/i.test(message)) {
      return "cards" as const;
    }
    return "text" as const;
  };

  const wantsFreshSportsData = (message: string) =>
    /\b(live|latest|today|tonight|now|current|score|updates?)\b/i.test(message);

  const fetchRagSnippets = async (queries: string[]) => {
    const chunks: string[] = [];
    for (const query of queries) {
      const snippets = await searchProvider.search(query);
      if (snippets.length) {
        chunks.push(...snippets.map((snippet) => `[${query}] ${snippet}`));
      }
    }
    return chunks;
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
    contextChunks.push(`Topic: ${topic}`);

    let matchName: string | undefined;
    if (topic === "sports" && query.matchId) {
      const matchContext = await buildMatchContext(query.matchId);
      if (matchContext) {
        contextChunks.push(matchContext.text);
        matchName = `${matchContext.match.teamA} vs ${matchContext.match.teamB}`;
      }
      const brief = await cacheGetJson(app.redis, `match:brief:${query.matchId}:current`);
      if (brief) contextChunks.push(`Match brief: ${JSON.stringify(brief)}`);
      const recap = await cacheGetJson(app.redis, `match:recap:${query.matchId}:current`);
      if (recap) contextChunks.push(`Match recap: ${JSON.stringify(recap)}`);
    }

    if (topic === "teer" && query.matchId) {
      const summary = await cacheGetJson(app.redis, `teer:summary:${query.matchId}:30`);
      if (summary) contextChunks.push(`Teer summary: ${JSON.stringify(summary)}`);
    }

    if (topic === "sports") {
      await maybeAddMatchList(userMessage, contextChunks);
    }

    if (topic === "markets") {
      const marketsContext = await buildMarketsContext(app.redis, app.env);
      if (marketsContext) contextChunks.push(marketsContext);
    }

    const shouldSearch = topic === "sports" && wantsFreshSportsData(userMessage);
    if (shouldSearch && !app.env.SERPER_API_KEY) {
      request.log.warn({ topic }, "SERPER_API_KEY missing; search disabled");
    }
    const searchQueries = shouldSearch ? buildSportsSearchQueries(userMessage, matchName) : [];
    const ragSnippets = shouldSearch ? await fetchRagSnippets(searchQueries) : [];
    if (shouldSearch) {
      request.log.info({ topic, snippetCount: ragSnippets.length }, "Search snippets fetched");
    }
    if (ragSnippets.length) {
      contextChunks.push(`RAG snippets: ${ragSnippets.join("\n")}`);
    }

    const responseMode = decideResponseMode(topic, userMessage);
    const cannedResponse = responseMode === "text" ? cannedSmallTalk(userMessage) : null;

    const language = (query.language as any) ?? "hinglish";
    let cardResponse = defaultCardResponse(language);
    let textResponse = cannedResponse ?? "Not available.";

    if (!cannedResponse) {
      const llmInput = {
        userMessage,
        language,
        context: contextChunks.join("\n\n"),
        maxTokens: 350,
        responseStyle: "short",
        outputFormat: responseMode,
        model: responseMode === "cards" ? analysisModel : chatModel
      };

      const response = await llmProvider.generateCards(llmInput);
      const validated = responseMode === "cards" ? cardResponseSchema.safeParse(response) : null;
      cardResponse = validated?.success ? validated.data : defaultCardResponse(llmInput.language);
      textResponse = typeof response === "string" ? response : "Not available.";
    }

    if (responseMode === "text") {
      cardResponse = toTextCardResponse(textResponse, language);
    }

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
    contextChunks.push(`Topic: ${session.topic}`);
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

    let sessionMatchName: string | undefined;
    if (session.topic === "sports" && session.refId) {
      const matchContext = await buildMatchContext(session.refId);
      if (matchContext) {
        contextChunks.push(matchContext.text);
        sessionMatchName = `${matchContext.match.teamA} vs ${matchContext.match.teamB}`;
      }
      const brief = await cacheGetJson(app.redis, `match:brief:${session.refId}:current`);
      if (brief) contextChunks.push(`Match brief: ${JSON.stringify(brief)}`);
      const recap = await cacheGetJson(app.redis, `match:recap:${session.refId}:current`);
      if (recap) contextChunks.push(`Match recap: ${JSON.stringify(recap)}`);
    }

    if (session.topic === "teer" && session.refId) {
      const summary = await cacheGetJson(app.redis, `teer:summary:${session.refId}:30`);
      if (summary) contextChunks.push(`Teer summary: ${JSON.stringify(summary)}`);
    }

    if (session.topic === "sports") {
      await maybeAddMatchList(parsed.data.message, contextChunks);
    }

    if (session.topic === "markets") {
      const marketsContext = await buildMarketsContext(app.redis, app.env);
      if (marketsContext) contextChunks.push(marketsContext);
    }

    const shouldSearch = session.topic === "sports" && wantsFreshSportsData(parsed.data.message);
    if (shouldSearch && !app.env.SERPER_API_KEY) {
      request.log.warn({ topic: session.topic }, "SERPER_API_KEY missing; search disabled");
    }
    const searchQueries = shouldSearch ? buildSportsSearchQueries(parsed.data.message, sessionMatchName) : [];
    const ragSnippets = shouldSearch ? await fetchRagSnippets(searchQueries) : [];
    if (shouldSearch) {
      request.log.info({ topic: session.topic, snippetCount: ragSnippets.length }, "Search snippets fetched");
    }
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
    const responseMode = decideResponseMode(session.topic, parsed.data.message);
    const cannedResponse = responseMode === "text" ? cannedSmallTalk(parsed.data.message) : null;

    const language = (prefs?.language as any) ?? "hinglish";
    let cardResponse = defaultCardResponse(language);
    let textResponse = cannedResponse ?? "Not available.";

    if (!cannedResponse) {
      const llmInput = {
        userMessage: parsed.data.message,
        language,
        context: contextChunks.join("\n\n"),
        maxTokens: plan.maxTokens,
        responseStyle,
        outputFormat: responseMode,
        model: responseMode === "cards" ? analysisModel : chatModel
      };

      const response = await llmProvider.generateCards(llmInput);
      const validated = responseMode === "cards" ? cardResponseSchema.safeParse(response) : null;
      cardResponse = validated?.success ? validated.data : defaultCardResponse(llmInput.language);
      textResponse = typeof response === "string" ? response : "Not available.";
    }

    if (responseMode === "text") {
      cardResponse = toTextCardResponse(textResponse, language);
    }

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
        content: responseMode === "cards" ? JSON.stringify(cardResponse) : textResponse,
        cardsJson: responseMode === "cards" ? (cardResponse as any) : null,
        tokenEstimate:
          responseMode === "cards" ? JSON.stringify(cardResponse).length : textResponse.length
      }
    });

    const assistantText = responseMode === "cards" ? extractCardText(cardResponse.cards as any) : textResponse;
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
