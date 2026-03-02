/**
 * provider-factory.ts — Factory that creates LLM providers from configuration.
 *
 * API keys are passed in at creation time from the credential vault.
 * The factory never stores or logs raw API keys.
 */
import type { LLMProviderConfig } from "@tessera/shared";
import { AnthropicProvider } from "./anthropic.provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { GeminiProvider } from "./gemini.provider.js";
import { OllamaProvider } from "./ollama.provider.js";
import type { LLMProvider } from "./provider.interface.js";

export function createProvider(config: LLMProviderConfig, apiKey?: string): LLMProvider {
  switch (config.provider) {
    case "anthropic": {
      if (!apiKey) throw new Error("Anthropic provider requires an API key from the vault");
      return new AnthropicProvider(config.model, apiKey);
    }
    case "openai": {
      if (!apiKey) throw new Error("OpenAI provider requires an API key from the vault");
      return new OpenAIProvider(config.model, apiKey, config.base_url);
    }
    case "gemini": {
      if (!apiKey) throw new Error("Gemini provider requires an API key from the vault");
      return new GeminiProvider(config.model, apiKey);
    }
    case "ollama": {
      // Ollama is local — no API key needed
      return new OllamaProvider(config.model, config.base_url);
    }
    default: {
      // TypeScript exhaustive check
      const _exhaustive: never = config;
      throw new Error(`Unknown provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
