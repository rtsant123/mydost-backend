import { PlanTier } from "@mydost/shared";

export type PlanConfig = {
  dailyMessages: number | "unlimited";
  maxTokens: number;
};

export const planConfig: Record<PlanTier, PlanConfig> = {
  free: { dailyMessages: 1, maxTokens: 400 },
  starter: { dailyMessages: 10, maxTokens: 700 },
  pro: { dailyMessages: "unlimited", maxTokens: 1200 }
};
