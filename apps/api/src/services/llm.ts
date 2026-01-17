import { cardResponseSchema, defaultCardResponse, systemPrompt } from "@mydost/shared";
import { SupportedLanguage } from "@mydost/shared";

export type LLMInput = {
  userMessage: string;
  language: SupportedLanguage;
  context: string;
  maxTokens: number;
  responseStyle?: string;
};

export type LLMProvider = {
  generateCards: (input: LLMInput) => Promise<unknown>;
};

export type SearchProvider = {
  search: (query: string) => Promise<string[]>;
};

export const createClaudeProvider = (apiKey?: string): LLMProvider => {
  if (!apiKey) {
    return {
      generateCards: async (input) => defaultCardResponse(input.language)
    };
  }

  const toFallbackCard = (text: string, language: SupportedLanguage) => ({
    cards: [
      {
        type: "answer" as const,
        title: "Response",
        confidence: 60,
        bullets: [text.trim() || "No response text returned."]
      }
    ],
    disclaimer: defaultCardResponse(language).disclaimer
  });

  return {
    generateCards: async (input) => {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: input.maxTokens,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `Context:\n${input.context}\n\nUser message:\n${input.userMessage}\n\nResponse style: ${input.responseStyle ?? "short"}\n\nReturn CardResponse JSON only.`
            }
          ]
        })
      });

      if (!response.ok) {
        return defaultCardResponse(input.language);
      }

      const payload = (await response.json()) as { content?: Array<{ type: string; text: string }> };
      const text = payload.content?.find((item) => item.type === "text")?.text ?? "";
      try {
        const parsed = JSON.parse(text);
        const validated = cardResponseSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch (error) {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          const sliced = text.slice(start, end + 1);
          try {
            const parsed = JSON.parse(sliced);
            const validated = cardResponseSchema.safeParse(parsed);
            if (validated.success) {
              return validated.data;
            }
          } catch (innerError) {
            // fall through to fallback card
          }
        }
      }
      return toFallbackCard(text, input.language);
    }
  };
};

export const createSearchProvider = (): SearchProvider => ({
  search: async () => []
});
