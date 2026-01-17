import { FastifyInstance } from "fastify";
import { getUsage } from "../services/usage";

export const registerUsageRoutes = (app: FastifyInstance) => {
  app.get("/api/usage/today", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { sub: string };
    const metric = await getUsage(payload.sub);
    return reply.send(metric);
  });
};
