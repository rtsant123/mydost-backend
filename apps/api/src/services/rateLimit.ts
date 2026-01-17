import { Redis } from "ioredis";

const rateLimitScript = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local bucketSize = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])

if tokens == nil then
  tokens = bucketSize
  last = now
else
  local delta = math.max(0, now - last)
  local refill = (delta / 60) * refillRate
  tokens = math.min(bucketSize, tokens + refill)
  last = now
end

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'last', last)
redis.call('EXPIRE', key, ttl)
return { allowed, tokens }
`;

export type RateLimitResult = { allowed: boolean; remaining: number };

export const consumeRateLimit = async (
  redis: Redis,
  key: string,
  nowSeconds: number,
  refillRate: number,
  bucketSize: number,
  ttlSeconds = 3600
): Promise<RateLimitResult> => {
  const result = (await redis.eval(rateLimitScript, 1, key, nowSeconds, refillRate, bucketSize, ttlSeconds)) as [
    number,
    number
  ];
  return { allowed: result[0] === 1, remaining: Math.floor(result[1]) };
};
