import { FastifyInstance } from "fastify";
import { prisma } from "@mydost/db";
import { chatMessageSchema, chatStartSchema, cardResponseSchema, defaultCardResponse } from "@mydost/shared";
import { createClaudeProvider, createSearchProvider } from "../services/llm";
import { cacheGetJson } from "../services/cache";
import { incrementUsage, getUsage } from "../services/usage";
import { planConfig } from "../services/plans";

export const registerChatRoutes = (app: FastifyInstance) => {
  const llmProvider = createClaudeProvider(app.env.CLAUDE_API_KEY);
  const searchProvider = createSearchProvider();

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

    const ragSnippets = await searchProvider.search(userMessage);
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

    const ragSnippets = await searchProvider.search(parsed.data.message);
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
