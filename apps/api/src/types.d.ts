import "fastify";
import { Env } from "./config";
import { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyInstance {
    env: Env;
    redis: Redis;
  }
}
