import type { SupportedProvider } from "@archer/model-providers";

export type ModelChoice = {
  value: string;
  label: string;
  description: string;
};

export const PROVIDER_CHOICES: Array<ModelChoice & { value: SupportedProvider }> = [
  { value: "openrouter", label: "OpenRouter", description: "Use OpenRouter's model catalog" },
  { value: "openai", label: "OpenAI", description: "Use OpenAI models" },
  { value: "anthropic", label: "Anthropic", description: "Use Claude models" },
  { value: "gemini", label: "Gemini", description: "Use Google Gemini models" },
];

export const MODEL_CHOICES_BY_PROVIDER: Record<SupportedProvider, ModelChoice[]> = {
  openrouter: [
    {
      value: "openrouter/free",
      label: "OpenRouter free",
      description: "Use the free OpenRouter model route",
    },
    {
      value: "openai/gpt-4o-mini",
      label: "GPT-4o mini",
      description: "Fast low-cost OpenAI model through OpenRouter",
    },
    {
      value: "anthropic/claude-3.5-sonnet",
      label: "Claude 3.5 Sonnet",
      description: "Strong general-purpose Claude model through OpenRouter",
    },
    {
      value: "google/gemini-2.0-flash-001",
      label: "Gemini 2.0 Flash",
      description: "Fast Gemini model through OpenRouter",
    },
  ],
  openai: [
    {
      value: "gpt-5-nano",
      label: "GPT-5 nano",
      description: "Cheapest OpenAI option for simple summarization and classification",
    },
    {
      value: "gpt-5.4-nano",
      label: "GPT-5.4 nano",
      description: "Very low-cost OpenAI model for simple high-volume tasks",
    },
    {
      value: "gpt-4o-mini",
      label: "GPT-4o mini",
      description: "Fast, affordable default for focused tasks",
    },
    {
      value: "gpt-4.1-mini",
      label: "GPT-4.1 mini",
      description: "Smaller model with strong tool calling",
    },
    {
      value: "gpt-5-mini",
      label: "GPT-5 mini",
      description: "Low-latency reasoning model",
    },
    {
      value: "gpt-5.4-mini",
      label: "GPT-5.4 mini",
      description: "Strong mini model for coding and agentic work",
    },
    {
      value: "gpt-5.2",
      label: "GPT-5.2",
      description: "Stronger, more expensive model for harder tasks",
    },
    {
      value: "gpt-5.4",
      label: "GPT-5.4",
      description: "High-quality OpenAI option for complex coding and agentic work",
    },
    {
      value: "gpt-5.5",
      label: "GPT-5.5",
      description: "Flagship OpenAI model for complex reasoning and coding",
    },
    {
      value: "gpt-5.5-pro",
      label: "GPT-5.5 pro",
      description: "Higher-compute GPT-5.5 option for the hardest tasks",
    },
  ],
  anthropic: [
    {
      value: "claude-3-5-sonnet-latest",
      label: "Claude 3.5 Sonnet",
      description: "Default Claude model for coding and agentic work",
    },
    {
      value: "claude-3-5-haiku-latest",
      label: "Claude 3.5 Haiku",
      description: "Lower-cost Claude model for faster tasks",
    },
    {
      value: "claude-3-opus-latest",
      label: "Claude 3 Opus",
      description: "Higher-capability Claude option",
    },
  ],
  gemini: [
    {
      value: "gemini-2.0-flash",
      label: "Gemini 2.0 Flash",
      description: "Fast default Gemini model",
    },
    {
      value: "gemini-1.5-flash",
      label: "Gemini 1.5 Flash",
      description: "Fast lower-cost Gemini model",
    },
    {
      value: "gemini-1.5-pro",
      label: "Gemini 1.5 Pro",
      description: "Stronger Gemini model for harder tasks",
    },
  ],
};
