import cron from "node-cron";
import pino from "pino";
import Redis from "ioredis";
import { loadEnv } from "./config";
import { refreshMatchBriefs, refreshTeerSummaries, generateMatchRecaps, syncSportsFixtures } from "./tasks";

const env = loadEnv();
const logger = pino();
const redis = new Redis(env.REDIS_URL);

const runTask = async (name: string, task: () => Promise<void>) => {
  try {
    logger.info({ task: name }, "Starting task");
    await task();
    logger.info({ task: name }, "Task completed");
  } catch (error) {
    logger.error({ task: name, error }, "Task failed");
  }
};

cron.schedule("0 */8 * * *", () => runTask("refreshMatchBriefs", () => refreshMatchBriefs(redis)));
cron.schedule("0 */6 * * *", () => runTask("refreshTeerSummaries", () => refreshTeerSummaries(redis)));
cron.schedule("15 * * * *", () => runTask("generateMatchRecaps", () => generateMatchRecaps(redis)));
cron.schedule("*/30 * * * *", () =>
  runTask("syncSportsFixtures", () => syncSportsFixtures(env.SPORTSDB_API_KEY))
);

logger.info("Worker started");
