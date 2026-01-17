import { FastifyInstance } from "fastify";
import { prisma } from "@mydost/db";
import { userPrefsSchema } from "@mydost/shared";

export const registerUserRoutes = (app: FastifyInstance) => {
  app.get("/api/me", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const payload = request.user as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return reply.status(404).send({ error: "User not found" });
    }
    const prefs = await prisma.userPrefs.findUnique({ where: { userId: user.id } });
    return reply.send({ user, prefs });
  });

  app.post("/api/prefs", async (request, reply) => {
    let payload: { sub: string } | null = null;
    try {
      await request.jwtVerify();
      payload = request.user as { sub: string };
    } catch (error) {
      payload = null;
    }

    const parsed = userPrefsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (!payload) {
      return reply.send({ prefs: parsed.data, persisted: false });
    }

    const prefs = await prisma.userPrefs.upsert({
      where: { userId: payload.sub },
      create: {
        userId: payload.sub,
        language: parsed.data.language,
        interestsJson: parsed.data.interests,
        favoritesJson: parsed.data.favorites ?? {},
        responseStyle: parsed.data.response_style
      },
      update: {
        language: parsed.data.language,
        interestsJson: parsed.data.interests,
        favoritesJson: parsed.data.favorites ?? {},
        responseStyle: parsed.data.response_style
      }
    });

    await app.redis.set(`user:prefs:${payload.sub}`, JSON.stringify(prefs), "EX", 3600);
    return reply.send({ prefs });
  });
};
