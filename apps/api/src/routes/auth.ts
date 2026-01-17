import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@mydost/db";
import { createGoogleClient, signUserToken, verifyGoogleToken } from "../services/auth";
import { userPrefsSchema } from "@mydost/shared";

const authSchema = z.object({ idToken: z.string().min(1) });

export const registerAuthRoutes = (app: FastifyInstance) => {
  const googleClient = createGoogleClient(app.env.GOOGLE_CLIENT_ID);

  app.post("/api/auth/google", async (request, reply) => {
    const parsed = authSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { email, name } = await verifyGoogleToken(googleClient, app.env.GOOGLE_CLIENT_ID, parsed.data.idToken);

    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name },
      update: { name, lastActiveAt: new Date() }
    });

    await prisma.userPrefs.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        language: "hinglish",
        interestsJson: ["sports", "teer", "astrology"],
        favoritesJson: {},
        responseStyle: "short"
      },
      update: {}
    });

    const token = signUserToken(app, { id: user.id, email: user.email, name: user.name, plan: user.plan });
    const prefs = userPrefsSchema.parse({
      language: "hinglish",
      interests: ["sports", "teer", "astrology"],
      response_style: "short"
    });

    return reply.send({ token, user, prefs });
  });
};
