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
  SERPER_API_KEY: z.string().optional(),
  ALPHA_VANTAGE_API_KEY: z.string().optional(),
  MARKET_STOCK_SYMBOLS: z.string().default("RELIANCE.BSE,TCS.BSE,INFY.BSE,HDFCBANK.BSE"),
  MARKET_CRYPTO_IDS: z.string().default("bitcoin,ethereum,solana"),
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
