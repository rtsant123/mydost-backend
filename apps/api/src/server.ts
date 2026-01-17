import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import { loadEnv } from "./config";
import { createRedis } from "./lib/redis";
import { consumeRateLimit } from "./services/rateLimit";
import { registerAuthRoutes } from "./routes/auth";
import { registerUserRoutes } from "./routes/user";
import { registerUsageRoutes } from "./routes/usage";
import { registerMatchRoutes } from "./routes/matches";
import { registerVoteRoutes } from "./routes/votes";
import { registerTeerRoutes } from "./routes/teer";
import { registerChatRoutes } from "./routes/chat";
import { registerAdminRoutes } from "./routes/admin";

export const buildServer = () => {
  const env = loadEnv();
  const app = Fastify({ logger: true });
  const redis = createRedis(env.REDIS_URL);

  app.decorate("env", env);
  app.decorate("redis", redis);

  app.register(cors, { origin: true });
  app.register(helmet);
  app.register(sensible);
  app.register(jwt, { secret: env.JWT_SECRET });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/api/webhooks")) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return;
    }

    const token = authHeader.replace("Bearer ", "");
    try {
      const payload = app.jwt.verify(token) as { sub: string };
      const nowSeconds = Math.floor(Date.now() / 1000);
      const rateKey = `rate:${payload.sub}`;
      const result = await consumeRateLimit(
        redis,
        rateKey,
        nowSeconds,
        env.RATE_LIMIT_TOKENS_PER_MINUTE,
        env.RATE_LIMIT_BUCKET_SIZE
      );
      reply.header("x-ratelimit-remaining", result.remaining);
      if (!result.allowed) {
        return reply.status(429).send({ error: "Rate limit exceeded" });
      }
    } catch (error) {
      request.log.warn({ error }, "Rate limit check failed");
    }
  });

  app.get("/api/health", async () => ({
    status: "ok",
    claudeKeyPresent: Boolean(env.CLAUDE_API_KEY)
  }));

  registerAuthRoutes(app);
  registerUserRoutes(app);
  registerUsageRoutes(app);
  registerMatchRoutes(app);
  registerVoteRoutes(app);
  registerTeerRoutes(app);
  registerChatRoutes(app);
  registerAdminRoutes(app);

  return app;
};
