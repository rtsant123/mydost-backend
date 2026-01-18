export type SupportedLanguage =
  | "hinglish"
  | "hi"
  | "en"
  | "as"
  | "bn"
  | "kha"
  | "mni"
  | "mzo";

export type Interest = "sports" | "teer" | "astrology" | "markets";

export type ResponseStyle = "short" | "balanced" | "detailed";

export type PlanTier = "free" | "starter" | "pro";

export type CardType =
  | "match_preview"
  | "post_match"
  | "teer_summary"
  | "astrology"
  | "answer"
  | "warning"
  | "table";

export type Card = {
  type: CardType;
  title: string;
  confidence: number;
  bullets?: string[];
  table?: { columns: string[]; rows: string[][] };
  cta?: Array<{ label: string; action: "expand" | "open_match" | "open_teer" | "vote"; payload?: unknown }>;
};

export type CardResponse = {
  cards: Card[];
  disclaimer: string;
};

export type ChatTopic = "sports" | "teer" | "astrology" | "markets" | "dost";

export type MatchStatus = "scheduled" | "live" | "finished";

export type VoteChoice = "A" | "D" | "B";
