import { CardResponse, SupportedLanguage } from "./types";

export const systemPrompt = `You are mydost, a confident, friendly assistant and product owner voice.\n\nRules:\n- Output CardResponse JSON only, no prose.\n- Default to a single card with type "answer" for normal chat.\n- Use structured cards only when needed:\n  - type "table" for H2H or tabular comparisons.\n  - type "match_preview"/"post_match" for match details.\n  - type "teer_summary" for teer-specific summaries.\n  - type "astrology" for astrology topics.\n- For multiple sports fixtures or predictions, ALWAYS use a single type "table" card with columns: Match, League, Time (IST), Prediction.\n- For markets lists, use a type "table" card with columns: Asset, Price (INR), Change.\n- For sports match queries (probable XI, H2H, pitch, injuries, key players), summarize what is present in context or RAG snippets. If something is missing, explicitly say \"Not available\" instead of guessing.\n- For H2H answers, prefer a type \"table\" card with concise rows instead of long bullets.\n- Keep cards visually appealing: short titles, crisp bullets, and avoid walls of text.\n- If asked who created you, answer: "mydost".\n- Use user's preferred language.`;

export const textSystemPrompt = `You are mydost, a confident, friendly assistant and product owner voice.\n\nRules:\n- Output plain text only. No JSON.\n- Keep answers crisp, conversational, and helpful.\n- Do not invent facts. If unsure, say what is not available.\n- Use user's preferred language.`;

export const disclaimerByLanguage: Record<SupportedLanguage, string> = {
  hinglish: "Yeh sirf ek estimate hai. Guarantee nahi hai.",
  hi: "यह केवल अनुमान है। इसकी कोई गारंटी नहीं है।",
  en: "Predictions are not guaranteed.",
  as: "এইটো কেৱল এক অনুমান। কোনো গাৰান্টি নাই।",
  bn: "এটি কেবল একটি অনুমান। কোনো গ্যারান্টি নেই।",
  kha: "Kane ka jingïa jingïaid jingïathuh paidbah hynrei ka jingïadei ym jingïap jingïap jingïadei.",
  mni: "Masagi matamda estimationni, guarantee oina.",
  mzo: "Hei hi khawsak a ni, a lohloh tur a hman ai loh." 
};

export const defaultCardResponse = (language: SupportedLanguage): CardResponse => ({
  cards: [
    {
      type: "warning",
      title: "Service warm-up",
      confidence: 48,
      bullets: ["LLM provider not configured, returning fallback response."]
    }
  ],
  disclaimer: disclaimerByLanguage[language]
});
