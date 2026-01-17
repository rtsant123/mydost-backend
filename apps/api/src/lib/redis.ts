import Redis from "ioredis";

export const createRedis = (url: string) => new Redis(url);
