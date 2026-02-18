// Token cost rates per 1M tokens (input, output) in USD
const COST_RATES: Record<string, [number, number]> = {
  // Anthropic
  "claude-3-5-haiku-20241022": [0.8, 4.0],
  "claude-3-5-sonnet-20241022": [3.0, 15.0],
  "claude-3-opus-20240229": [15.0, 75.0],
  "claude-3-haiku-20240307": [0.25, 1.25],
  // OpenAI
  "gpt-4o": [2.5, 10.0],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4-turbo": [10.0, 30.0],
  "gpt-3.5-turbo": [0.5, 1.5],
  // Gemini
  "gemini-2.0-flash": [0.075, 0.3],
  "gemini-2.0-flash-lite": [0.0375, 0.15],
  "gemini-1.5-pro": [1.25, 5.0],
  "gemini-1.5-flash": [0.075, 0.3],
  // Ollama: always free (local)
};

const DEFAULT_RATE: [number, number] = [3.0, 15.0]; // Conservative default

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const [inputRate, outputRate] = COST_RATES[model] ?? DEFAULT_RATE;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}

export function formatCostUsd(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}
