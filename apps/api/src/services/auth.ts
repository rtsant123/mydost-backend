import { OAuth2Client } from "google-auth-library";
import { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "@mydost/db";

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  plan: string;
};

export const createGoogleClient = (clientId: string) => new OAuth2Client(clientId);

export const verifyGoogleToken = async (client: OAuth2Client, clientId: string, idToken: string) => {
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw new Error("Invalid Google token");
  }
  return {
    email: payload.email,
    name: payload.name ?? null
  };
};

export const signUserToken = (app: FastifyInstance, user: AuthUser) =>
  app.jwt.sign({ sub: user.id, email: user.email, plan: user.plan });

export const requireUser = async (request: FastifyRequest) => {
  await request.jwtVerify();
  const payload = request.user as { sub: string; email: string };
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new Error("User not found");
  }
  return user;
};
