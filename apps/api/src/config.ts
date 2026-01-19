import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  ADMIN_EMAILS: z.string().default(""),
  CLAUDE_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().optional(),
  CLAUDE_MODEL_CHAT: z.string().optional(),
  CLAUDE_MODEL_ANALYSIS: z.string().optional(),
  LLM_MAX_INPUT_CHARS: z.coerce.number().default(1200),
  LLM_MAX_CONTEXT_CHARS: z.coerce.number().default(8000),
  LLM_MAX_SEARCH_SNIPPETS: z.coerce.number().default(6),
  LLM_MAX_SEARCH_CHARS: z.coerce.number().default(360),
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().default(86400),
  SERPER_API_KEY: z.string().optional(),
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
  MARKET_STOCK_SYMBOLS: z.string().default("RELIANCE.BSE,TCS.BSE,INFY.BSE,HDFCBANK.BSE"),
  MARKET_CRYPTO_SYMBOLS: z.string().default("BTC,ETH,SOL"),
  FREECRYPTO_API_KEY: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RATE_LIMIT_TOKENS_PER_MINUTE: z.coerce.number().default(30),
  RATE_LIMIT_BUCKET_SIZE: z.coerce.number().default(60)
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (): Env => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment variables: ${JSON.stringify(formatted)}`);
  }
  return parsed.data;
};
