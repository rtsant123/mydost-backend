import { FastifyInstance } from "fastify";
import { prisma, VoteChoice } from "@mydost/db";
import { voteSchema } from "@mydost/shared";
import { cacheSetJson } from "../services/cache";

const calculateAggregate = async (matchId: string) => {
  const votes = await prisma.vote.findMany({ where: { matchId } });
  const total = votes.length;
  const counts = votes.reduce(
    (acc, vote) => {
      acc[vote.choice] += 1;
      return acc;
    },
    { A: 0, D: 0, B: 0 } as Record<VoteChoice, number>
  );
  const aggregate = {
    aPct: total ? (counts.A / total) * 100 : 0,
    dPct: total ? (counts.D / total) * 100 : 0,
    bPct: total ? (counts.B / total) * 100 : 0,
    totalVotes: total
  };

  return prisma.voteAggregate.upsert({
    where: { matchId },
    create: { matchId, ...aggregate },
    update: { ...aggregate }
  });
};

export const registerVoteRoutes = (app: FastifyInstance) => {
  app.post("/api/matches/:id/vote", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { sub: string };
    const params = request.params as { id: string };
    const parsed = voteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    await prisma.vote.upsert({
      where: { matchId_userId: { matchId: params.id, userId: payload.sub } },
      create: { matchId: params.id, userId: payload.sub, choice: parsed.data.choice },
      update: { choice: parsed.data.choice }
    });

    const aggregate = await calculateAggregate(params.id);
    await cacheSetJson(app.redis, `vote:agg:${params.id}`, aggregate, 60 * 10);
    return reply.send(aggregate);
  });

  app.get("/api/matches/:id/votes", async (request, reply) => {
    const params = request.params as { id: string };
    const aggregate = await prisma.voteAggregate.findUnique({ where: { matchId: params.id } });
    if (!aggregate) {
      return reply.send({ matchId: params.id, aPct: 0, dPct: 0, bPct: 0, totalVotes: 0 });
    }
    return reply.send(aggregate);
  });
};
