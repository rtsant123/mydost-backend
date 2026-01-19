import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SPORTSDB_API_KEY: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
  MARKET_STOCK_SYMBOLS: z.string().default("RELIANCE.BSE,TCS.BSE,INFY.BSE,HDFCBANK.BSE"),
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  RAG_PREFETCH_DAYS: z.coerce.number().default(2),
  RAG_PREFETCH_MATCH_LIMIT: z.coerce.number().default(60),
  RAG_PREFETCH_ENABLED: z.coerce.boolean().default(false)
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (): Env => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
  }
  return parsed.data;
};
