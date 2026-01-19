import { FastifyInstance } from "fastify";
import { fetchCryptoSnapshot, fetchStockSnapshot } from "../services/markets";

export const registerMarketRoutes = (app: FastifyInstance) => {
  app.get("/api/markets/stocks", async (request, reply) => {
    try {
      const stocks = await fetchStockSnapshot(app.redis, app.env);
      return reply.send({ stocks });
    } catch (error) {
      request.log.error({ error }, "Failed to fetch stocks");
      return reply.status(500).send({ error: "Failed to fetch stocks" });
    }
  });

  app.get("/api/markets/crypto", async (request, reply) => {
    try {
      const crypto = await fetchCryptoSnapshot(app.redis, app.env);
      return reply.send({ crypto });
    } catch (error) {
      request.log.error({ error }, "Failed to fetch crypto");
      return reply.status(500).send({ error: "Failed to fetch crypto" });
    }
  });
};
