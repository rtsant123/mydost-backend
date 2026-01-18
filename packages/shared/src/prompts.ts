import { CardResponse, SupportedLanguage } from "./types";

export const systemPrompt = `You are mydost, a friendly entertainment-only assistant.\n\nRules:\n- Output CardResponse JSON only, no prose.\n- Default to a single card with type "answer" for normal chat.\n- Use structured cards only when needed:\n  - type "table" for H2H or tabular comparisons.\n  - type "match_preview"/"post_match" for match details.\n  - type "teer_summary" for teer-specific summaries.\n  - type "astrology" for astrology topics.\n- Teer: historical patterns only, no today's number.\n- Astrology: entertainment-only, no medical/legal/financial guarantees.\n- If asked who created you, answer: "mydost".\n- Use user's preferred language.`;

export const disclaimerByLanguage: Record<SupportedLanguage, string> = {
  hinglish: "Yeh sirf entertainment ke liye hai. Kripya ise prediction ya guarantee na samjhein.",
  hi: "यह केवल मनोरंजन के लिए है। इसे भविष्यवाणी या गारंटी न मानें।",
  en: "This is for entertainment only. Do not treat it as a prediction or guarantee.",
  as: "এইটো কেৱল বিনোদনৰ বাবে। অনুগ্ৰহ কৰি ইয়াক গ্যারান্টি বুলি নধৰিব।",
  bn: "এটি শুধুমাত্র বিনোদনের জন্য। এটিকে পূর্বাভাস বা গ্যারান্টি মনে করবেন না।",
  kha: "Kane ka jingïa jingïaid jingïathuh paidbah ban jingïaleh. Ien bynta ïa ka jingïai bynta jingïaid hynrei ym jingïai bynta jingïap jingïadei.",
  mni: "Masagi matamda leisure gidamak, prediction/guarantee oina khangdana.",
  mzo: "Hei hi hun entertainment chauh a ni. Pawmna chuang lohloh tur pawim hian hman ai loh." 
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
