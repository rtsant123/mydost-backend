import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mydost/db";
import { generateMatchBrief, generateMatchRecap } from "../services/matches";
import { cacheSetJson } from "../services/cache";
import { isAdminEmail } from "../services/admin";

const matchCreateSchema = z.object({
  sport: z.string().min(1),
  league: z.string().min(1),
  teamA: z.string().min(1),
  teamB: z.string().min(1),
  startTime: z.string().datetime()
});

const matchQuerySchema = z.object({
  sport: z.string().optional(),
  status: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  includeVotes: z.coerce.boolean().optional()
});

export const registerMatchRoutes = (app: FastifyInstance) => {
  app.get("/api/matches", async (request, reply) => {
    const parsed = matchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }
    const query = parsed.data;
    const startTime =
      query.from || query.to
        ? {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {})
          }
        : undefined;
    const matches = await prisma.match.findMany({
      where: {
        sport: query.sport,
        status: query.status as any,
        startTime
      },
      orderBy: { startTime: "asc" },
      include: query.includeVotes ? { aggregates: true } : undefined
    });
    return reply.send(matches);
  });

  app.get("/api/matches/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const match = await prisma.match.findUnique({ where: { id: params.id } });
    if (!match) {
      return reply.status(404).send({ error: "Match not found" });
    }
    return reply.send(match);
  });

  app.post("/api/matches", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { email: string };
    if (!isAdminEmail(app, payload.email)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const parsed = matchCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const match = await prisma.match.create({
      data: {
        sport: parsed.data.sport,
        league: parsed.data.league,
        teamA: parsed.data.teamA,
        teamB: parsed.data.teamB,
        startTime: new Date(parsed.data.startTime)
      }
    });

    return reply.status(201).send(match);
  });

  app.post("/api/matches/:id/refresh-brief", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { email: string };
    if (!isAdminEmail(app, payload.email)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const params = request.params as { id: string };
    const brief = await generateMatchBrief(params.id);
    await cacheSetJson(app.redis, `match:brief:${params.id}:current`, brief, 60 * 60 * 8);
    await cacheSetJson(app.redis, `match:brief:${params.id}:v${brief.version}`, brief, 60 * 60 * 8);
    return reply.send(brief);
  });

  app.post("/api/matches/:id/refresh-recap", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { email: string };
    if (!isAdminEmail(app, payload.email)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    const params = request.params as { id: string };
    const recap = await generateMatchRecap(params.id);
    await cacheSetJson(app.redis, `match:recap:${params.id}:current`, recap, 60 * 60 * 12);
    return reply.send(recap);
  });
};
