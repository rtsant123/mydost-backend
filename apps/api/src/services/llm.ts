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
      const parsed = JSON.parse(text);
      const validated = cardResponseSchema.safeParse(parsed);
      if (!validated.success) {
        return defaultCardResponse(input.language);
      }
      return validated.data;
    }
  };
};

export const createSearchProvider = (): SearchProvider => ({
  search: async () => []
});
