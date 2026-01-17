import { FastifyInstance } from "fastify";
import { prisma } from "@mydost/db";
import { cacheGetJson, cacheSetJson } from "../services/cache";

const normalizeHouse = (house: string) => house.trim().toLowerCase();

const disallowKolkata = (house: string) => {
  if (normalizeHouse(house) === "kolkata") {
    throw new Error("Kolkata teer not supported");
  }
};

export const registerTeerRoutes = (app: FastifyInstance) => {
  app.get("/api/teer/:house/latest", async (request, reply) => {
    const params = request.params as { house: string };
    try {
      disallowKolkata(params.house);
    } catch (error) {
      return reply.status(400).send({ error: "Kolkata teer is not supported" });
    }

    const cacheKey = `teer:latest:${params.house}`;
    const cached = await cacheGetJson(app.redis, cacheKey);
    if (cached) {
      return reply.send(cached);
    }

    const latest = await prisma.teerResult.findFirst({
      where: { house: params.house },
      orderBy: { date: "desc" }
    });
    if (!latest) {
      return reply.status(404).send({ error: "No results" });
    }
    await cacheSetJson(app.redis, cacheKey, latest, 60 * 60);
    return reply.send(latest);
  });

  app.get("/api/teer/:house/history", async (request, reply) => {
    const params = request.params as { house: string };
    const query = request.query as { days?: string };
    try {
      disallowKolkata(params.house);
    } catch (error) {
      return reply.status(400).send({ error: "Kolkata teer is not supported" });
    }

    const days = Number(query.days ?? 30);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const results = await prisma.teerResult.findMany({
      where: { house: params.house, date: { gte: since } },
      orderBy: { date: "desc" }
    });
    return reply.send(results);
  });

  app.get("/api/teer/:house/summary", async (request, reply) => {
    const params = request.params as { house: string };
    const query = request.query as { days?: string };
    try {
      disallowKolkata(params.house);
    } catch (error) {
      return reply.status(400).send({ error: "Kolkata teer is not supported" });
    }

    const days = Number(query.days ?? 30);
    const cacheKey = `teer:summary:${params.house}:${days}`;
    const cached = await cacheGetJson(app.redis, cacheKey);
    if (cached) {
      return reply.send(cached);
    }

    const summary = await prisma.teerSummary.findUnique({
      where: { house_windowDays: { house: params.house, windowDays: days } }
    });
    if (!summary) {
      return reply.status(404).send({ error: "No summary" });
    }
    await cacheSetJson(app.redis, cacheKey, summary, 60 * 60 * 6);
    return reply.send(summary);
  });
};
