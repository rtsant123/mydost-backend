import { FastifyInstance } from "fastify";

export const isAdminEmail = (app: FastifyInstance, email: string | undefined) => {
  if (!email) return false;
  const adminEmails = app.env.ADMIN_EMAILS.split(",").map((value) => value.trim());
  return adminEmails.includes(email);
};
