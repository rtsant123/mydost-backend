import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server";

const withEnv = () => {
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.JWT_SECRET = "secret";
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.ADMIN_EMAILS = "admin@example.com";
};

describe("health", () => {
  it("returns ok", async () => {
    withEnv();
    const app = buildServer();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});
