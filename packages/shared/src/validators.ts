import { z } from "zod";

export const supportedLanguages = [
  "hinglish",
  "hi",
  "en",
  "as",
  "bn",
  "kha",
  "mni",
  "mzo"
] as const;

export const interests = ["sports", "teer", "astrology"] as const;

export const responseStyles = ["short", "balanced", "detailed"] as const;

export const planTiers = ["free", "starter", "pro"] as const;

export const cardSchema = z.object({
  type: z.enum(["match_preview", "post_match", "teer_summary", "astrology", "answer", "warning", "table"]),
  title: z.string().min(1),
  confidence: z.number().min(0).max(100),
  bullets: z.array(z.string()).optional(),
  table: z
    .object({
      columns: z.array(z.string().min(1)),
      rows: z.array(z.array(z.string()))
    })
    .optional(),
  cta: z
    .array(
      z.object({
        label: z.string(),
        action: z.enum(["expand", "open_match", "open_teer", "vote"]),
        payload: z.unknown().optional()
      })
    )
    .optional()
});

export const cardResponseSchema = z.object({
  cards: z.array(cardSchema),
  disclaimer: z.string()
});

export const userPrefsSchema = z.object({
  language: z.enum(supportedLanguages).default("hinglish"),
  interests: z.array(z.enum(interests)).default(["sports", "teer", "astrology"]),
  favorites: z
    .object({
      favorite_teams: z.array(z.string()).optional(),
      teer_houses_followed: z.array(z.string()).optional()
    })
    .optional(),
  response_style: z.enum(responseStyles).default("short")
});

export const chatMessageSchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1)
});

export const chatStartSchema = z.object({
  topic: z.enum(["sports", "teer", "astrology"]),
  refId: z.string().optional()
});

export const voteSchema = z.object({
  choice: z.enum(["A", "D", "B"])
});

export const planWebhookSchema = z.object({
  event: z.string(),
  payload: z.unknown()
});
