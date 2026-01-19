import { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "crypto";
import { prisma, PlanTier } from "@mydost/db";
import { isAdminEmail } from "../services/admin";

const teerImportSchema = z.array(
  z.object({
    house: z.string().min(1),
    date: z.string().datetime(),
    r1: z.number(),
    r2: z.number(),
    source: z.string().min(1)
  })
);

const webhookSchema = z.object({
  event: z.string(),
  payload: z.object({
    subscription: z.object({
      entity: z.object({
        notes: z.object({ userId: z.string().uuid().optional() }).optional(),
        plan_id: z.string().optional()
      })
    }).optional()
  })
});

const mapPlan = (planId?: string): PlanTier => {
  if (planId?.includes("499")) return "pro";
  if (planId?.includes("99")) return "starter";
  return "free";
};

export const registerAdminRoutes = (app: FastifyInstance) => {
  app.post("/api/admin/teer/import", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { email: string };
    if (!isAdminEmail(app, payload.email)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const parsed = teerImportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const results = await prisma.$transaction(
      parsed.data.map((item) =>
        prisma.teerResult.upsert({
          where: { house_date: { house: item.house, date: new Date(item.date) } },
          create: {
            house: item.house,
            date: new Date(item.date),
            r1: item.r1,
            r2: item.r2,
            source: item.source
          },
          update: { r1: item.r1, r2: item.r2, source: item.source }
        })
      )
    );

    return reply.send({ inserted: results.length });
  });

  app.post("/api/webhooks/razorpay", async (request, reply) => {
    const signature = request.headers["x-razorpay-signature"] as string | undefined;
    if (!signature || !app.env.RAZORPAY_WEBHOOK_SECRET) {
      return reply.status(401).send({ error: "Signature missing" });
    }

    const body = JSON.stringify(request.body ?? {});
    const expected = crypto
      .createHmac("sha256", app.env.RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    if (expected !== signature) {
      return reply.status(401).send({ error: "Invalid signature" });
    }

    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const userId = parsed.data.payload.subscription?.entity.notes?.userId;
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: { plan: mapPlan(parsed.data.payload.subscription?.entity.plan_id) }
      });
    }

    return reply.send({ status: "ok" });
  });

  app.get("/api/admin/debug/status", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { email: string };
    if (!isAdminEmail(app, payload.email)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const stockSymbols = app.env.MARKET_STOCK_SYMBOLS?.toUpperCase() ?? "";
    const cacheKey = stockSymbols ? `markets:stocks:${stockSymbols}` : null;
    const [cachedStocksRaw, ttlSeconds, matchCount, liveCount] = await Promise.all([
      cacheKey ? app.redis.get(cacheKey) : Promise.resolve(null),
      cacheKey ? app.redis.ttl(cacheKey) : Promise.resolve(-2),
      prisma.match.count(),
      prisma.match.count({ where: { status: { in: ["scheduled", "live"] } } })
    ]);

    return reply.send({
      now: new Date().toISOString(),
      stocks: {
        symbols: stockSymbols,
        cacheKey,
        ttlSeconds,
        cached: cachedStocksRaw ? JSON.parse(cachedStocksRaw) : null
      },
      sports: {
        totalMatches: matchCount,
        scheduledOrLive: liveCount
      },
      env: {
        hasAlphaVantage: Boolean(app.env.ALPHA_VANTAGE_API_KEY),
        hasSerper: Boolean(app.env.SERPER_API_KEY)
      }
    });
  });
};
