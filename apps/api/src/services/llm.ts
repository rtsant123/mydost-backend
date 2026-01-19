import { cardResponseSchema, defaultCardResponse, systemPrompt, textSystemPrompt } from "@mydost/shared";
import { SupportedLanguage } from "@mydost/shared";
import crypto from "crypto";
import { Redis } from "ioredis";

export type LLMInput = {
  userMessage: string;
  language: SupportedLanguage;
  context: string;
  maxTokens: number;
  responseStyle?: string;
  outputFormat?: "cards" | "text";
  model?: string;
  systemPromptOverride?: string;
};

export type LLMProvider = {
  generateCards: (input: LLMInput) => Promise<unknown>;
};

export type SearchProvider = {
  search: (query: string) => Promise<string[]>;
};

type ClaudeOptions = {
  model?: string;
  maxInputChars?: number;
  maxContextChars?: number;
};

type SearchOptions = {
  cacheTtlSeconds?: number;
  maxSnippets?: number;
  maxSnippetChars?: number;
};

const clampText = (value: string, maxChars?: number) => {
  if (!maxChars || value.length <= maxChars) return value;
  return value.slice(0, maxChars);
};

const clampContext = (value: string, maxChars?: number) => {
  if (!maxChars || value.length <= maxChars) return value;
  return value.slice(-maxChars);
};

export const createClaudeProvider = (apiKey?: string, options?: ClaudeOptions): LLMProvider => {
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
      const safeUserMessage = clampText(input.userMessage, options?.maxInputChars);
      const safeContext = clampContext(input.context, options?.maxContextChars);
      const model = input.model ?? options?.model ?? "claude-3-5-haiku-20241022";
      const outputFormat = input.outputFormat ?? "cards";
      const system =
        input.systemPromptOverride ?? (outputFormat === "text" ? textSystemPrompt : systemPrompt);

      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model,
            max_tokens: input.maxTokens,
            system,
            messages: [
              {
                role: "user",
                content:
                  outputFormat === "text"
                    ? `Context:\n${safeContext}\n\nUser message:\n${safeUserMessage}\n\nResponse style: ${input.responseStyle ?? "short"}`
                    : `Context:\n${safeContext}\n\nUser message:\n${safeUserMessage}\n\nResponse style: ${input.responseStyle ?? "short"}\n\nReturn CardResponse JSON only.`
              }
            ]
          })
        });

        if (!response.ok) {
          return outputFormat === "text" ? "Not available." : defaultCardResponse(input.language);
        }

        const payload = (await response.json()) as { content?: Array<{ type: string; text: string }> };
        const text = payload.content?.find((item) => item.type === "text")?.text ?? "";
        if (outputFormat === "text") {
          return text.trim() || "Not available.";
        }
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
      } catch (error) {
        return outputFormat === "text" ? "Not available." : defaultCardResponse(input.language);
      }
    }
  };
};

const hashKey = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export const createSearchProvider = (
  redis: Redis,
  apiKey?: string,
  options?: SearchOptions
): SearchProvider => ({
  search: async (query) => {
    const trimmed = query.trim();
    if (!trimmed || !apiKey) {
      return [];
    }

    const cacheKey = `search:${hashKey(trimmed.toLowerCase())}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as string[];
      } catch (error) {
        // ignore cache parse errors
      }
    }

    try {
      const response = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ q: trimmed })
      });

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as {
        organic?: Array<{ title?: string; snippet?: string; link?: string }>;
      };

      const snippets =
        payload.organic
          ?.map((item) => [item.title, item.snippet, item.link].filter(Boolean).join(" - "))
          .filter(Boolean) ?? [];

      const maxSnippetChars = options?.maxSnippetChars ?? 360;
      const maxSnippets = options?.maxSnippets ?? 6;
      const sliced = snippets
        .map((item) => (item.length > maxSnippetChars ? item.slice(0, maxSnippetChars) : item))
        .slice(0, maxSnippets);

      if (sliced.length) {
        await redis.set(cacheKey, JSON.stringify(sliced), "EX", options?.cacheTtlSeconds ?? 86400);
      }

      return sliced;
    } catch (error) {
      return [];
    }
  }
});
