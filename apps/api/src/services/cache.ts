import { Redis } from "ioredis";

export const cacheGetJson = async <T>(redis: Redis, key: string): Promise<T | null> => {
  const raw = await redis.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
};

export const cacheSetJson = async (redis: Redis, key: string, value: unknown, ttlSeconds?: number) => {
  const payload = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.set(key, payload, "EX", ttlSeconds);
  } else {
    await redis.set(key, payload);
  }
};
