import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupportedProvider } from "@xeq/model-providers";
import type { SupportedWebProvider } from "@xeq/web";

export type AuthSource = "env" | "saved";

export type StoredProviderAuth = {
  key: string;
};

export type AuthStore = {
  version: 1;
  defaultProvider?: SupportedProvider;
  providers: Partial<Record<SupportedProvider, StoredProviderAuth>>;
  defaultWebProvider?: SupportedWebProvider;
  webProviders: Partial<Record<SupportedWebProvider, StoredProviderAuth>>;
};

export type ActiveProviderState = {
  provider: SupportedProvider;
  modelId: string;
  authSource: AuthSource;
};

export type ActiveWebProviderState = {
  provider: SupportedWebProvider;
  authSource: AuthSource;
  apiKey: string;
};

const AUTH_DIR = path.join(os.homedir(), ".local", "share", "xeq");
const AUTH_FILE = path.join(AUTH_DIR, "auth.json");
const SUPPORTED_PROVIDERS: SupportedProvider[] = ["openrouter", "openai", "anthropic", "gemini"];
const SUPPORTED_WEB_PROVIDERS: SupportedWebProvider[] = ["tavily", "exa"];

function isSupportedProvider(value: string): value is SupportedProvider {
  return SUPPORTED_PROVIDERS.includes(value as SupportedProvider);
}

function isSupportedWebProvider(value: string): value is SupportedWebProvider {
  return SUPPORTED_WEB_PROVIDERS.includes(value as SupportedWebProvider);
}

export function getAuthFilePath(): string {
  return AUTH_FILE;
}

export function defaultModelForProvider(provider: SupportedProvider): string {
  switch (provider) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "gemini":
      return "gemini-2.0-flash";
    default:
      return "openai/gpt-4o-mini";
  }
}

export function normalizeProvider(input: string): SupportedProvider | null {
  const value = input.trim().toLowerCase();
  if (value === "codex") return "openai";
  if (value === "claude") return "anthropic";
  if (value === "google") return "gemini";
  return isSupportedProvider(value) ? value : null;
}

export function normalizeWebProvider(input: string): SupportedWebProvider | null {
  const value = input.trim().toLowerCase();
  return isSupportedWebProvider(value) ? value : null;
}

function providerEnvVar(provider: SupportedProvider): string {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "gemini":
      return "GEMINI_API_KEY";
    default:
      return "OPENROUTER_API_KEY";
  }
}

function getEnvKey(provider: SupportedProvider, env: NodeJS.ProcessEnv): string | undefined {
  if (provider === "gemini") {
    return env.GEMINI_API_KEY ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
  return env[providerEnvVar(provider)];
}

function hasProviderCredential(provider: SupportedProvider, store: AuthStore, env: NodeJS.ProcessEnv): boolean {
  return Boolean(getEnvKey(provider, env) ?? store.providers[provider]?.key);
}

function webProviderEnvVar(provider: SupportedWebProvider): string {
  switch (provider) {
    case "exa":
      return "EXA_API_KEY";
    default:
      return "TAVILY_API_KEY";
  }
}

function getWebEnvKey(provider: SupportedWebProvider, env: NodeJS.ProcessEnv): string | undefined {
  return env[webProviderEnvVar(provider)];
}

function emptyStore(): AuthStore {
  return {
    version: 1,
    providers: {},
    webProviders: {},
  };
}

function parseStore(raw: unknown): AuthStore {
  if (typeof raw !== "object" || raw === null) {
    return emptyStore();
  }

  const record = raw as Record<string, unknown>;
  const providers =
    typeof record.providers === "object" && record.providers !== null ? record.providers : {};
  const normalizedProviders: AuthStore["providers"] = {};
  const webProviders =
    typeof record.webProviders === "object" && record.webProviders !== null
      ? record.webProviders
      : {};
  const normalizedWebProviders: AuthStore["webProviders"] = {};

  for (const [key, value] of Object.entries(providers)) {
    if (!isSupportedProvider(key)) continue;
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.key !== "string" || entry.key.trim().length === 0) continue;
    normalizedProviders[key] = { key: entry.key };
  }

  for (const [key, value] of Object.entries(webProviders)) {
    if (!isSupportedWebProvider(key)) continue;
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry.key !== "string" || entry.key.trim().length === 0) continue;
    normalizedWebProviders[key] = { key: entry.key };
  }

  const defaultProvider =
    typeof record.defaultProvider === "string" && isSupportedProvider(record.defaultProvider)
      ? record.defaultProvider
      : undefined;
  const defaultWebProvider =
    typeof record.defaultWebProvider === "string" &&
    isSupportedWebProvider(record.defaultWebProvider)
      ? record.defaultWebProvider
      : undefined;

  return {
    version: 1,
    defaultProvider,
    providers: normalizedProviders,
    defaultWebProvider,
    webProviders: normalizedWebProviders,
  };
}

export async function readAuthStore(): Promise<AuthStore> {
  try {
    const content = await readFile(AUTH_FILE, "utf8");
    return parseStore(JSON.parse(content));
  } catch {
    return emptyStore();
  }
}

export async function writeAuthStore(store: AuthStore): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  await writeFile(AUTH_FILE, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function saveProviderAuth(provider: SupportedProvider, key: string): Promise<void> {
  const store = await readAuthStore();
  store.providers[provider] = { key };
  store.defaultProvider = provider;
  await writeAuthStore(store);
}

export async function saveWebProviderAuth(
  provider: SupportedWebProvider,
  key: string,
): Promise<void> {
  const store = await readAuthStore();
  store.webProviders[provider] = { key };
  store.defaultWebProvider = provider;
  await writeAuthStore(store);
}

export async function removeProviderAuth(provider: SupportedProvider): Promise<boolean> {
  const store = await readAuthStore();
  const existed = Boolean(store.providers[provider]);
  delete store.providers[provider];

  if (store.defaultProvider === provider) {
    const remaining = SUPPORTED_PROVIDERS.find((item) => Boolean(store.providers[item]));
    store.defaultProvider = remaining;
  }

  await writeAuthStore(store);
  return existed;
}

export async function removeWebProviderAuth(provider: SupportedWebProvider): Promise<boolean> {
  const store = await readAuthStore();
  const existed = Boolean(store.webProviders[provider]);
  delete store.webProviders[provider];

  if (store.defaultWebProvider === provider) {
    const remaining = SUPPORTED_WEB_PROVIDERS.find((item) => Boolean(store.webProviders[item]));
    store.defaultWebProvider = remaining;
  }

  await writeAuthStore(store);
  return existed;
}

export async function listSavedProviders(): Promise<SupportedProvider[]> {
  const store = await readAuthStore();
  return SUPPORTED_PROVIDERS.filter((provider) => Boolean(store.providers[provider]));
}

export async function listAvailableProviders(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupportedProvider[]> {
  const store = await readAuthStore();
  return SUPPORTED_PROVIDERS.filter((provider) => hasProviderCredential(provider, store, env));
}

export async function listSavedWebProviders(): Promise<SupportedWebProvider[]> {
  const store = await readAuthStore();
  return SUPPORTED_WEB_PROVIDERS.filter((provider) => Boolean(store.webProviders[provider]));
}

export async function resolveActiveProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ActiveProviderState | null> {
  const explicitProvider =
    typeof env.XEQ_PROVIDER === "string" ? normalizeProvider(env.XEQ_PROVIDER) : null;
  const store = await readAuthStore();

  const chooseSavedProvider = (): SupportedProvider | null => {
    if (store.defaultProvider && store.providers[store.defaultProvider]) {
      return store.defaultProvider;
    }

    return SUPPORTED_PROVIDERS.find((provider) => Boolean(store.providers[provider])) ?? null;
  };

  if (explicitProvider) {
    const envKey = getEnvKey(explicitProvider, env);
    if (envKey) {
      env.XEQ_PROVIDER = explicitProvider;
      env.AGENT_MODEL ??= defaultModelForProvider(explicitProvider);
      return {
        provider: explicitProvider,
        modelId: env.AGENT_MODEL,
        authSource: "env",
      };
    }

    const savedKey = store.providers[explicitProvider]?.key;
    if (savedKey) {
      env.XEQ_PROVIDER = explicitProvider;
      env[providerEnvVar(explicitProvider)] = savedKey;
      env.AGENT_MODEL ??= defaultModelForProvider(explicitProvider);
      return {
        provider: explicitProvider,
        modelId: env.AGENT_MODEL,
        authSource: "saved",
      };
    }

    return null;
  }

  for (const provider of SUPPORTED_PROVIDERS) {
    if (!getEnvKey(provider, env)) continue;
    env.XEQ_PROVIDER = provider;
    env.AGENT_MODEL ??= defaultModelForProvider(provider);
    return {
      provider,
      modelId: env.AGENT_MODEL,
      authSource: "env",
    };
  }

  const savedProvider = chooseSavedProvider();
  if (!savedProvider) return null;

  const savedKey = store.providers[savedProvider]?.key;
  if (!savedKey) return null;

  env.XEQ_PROVIDER = savedProvider;
  env[providerEnvVar(savedProvider)] = savedKey;
  env.AGENT_MODEL ??= defaultModelForProvider(savedProvider);
  return {
    provider: savedProvider,
    modelId: env.AGENT_MODEL,
    authSource: "saved",
  };
}

export async function resolveActiveWebProvider(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ActiveWebProviderState | null> {
  const explicitProvider =
    typeof env.XEQ_WEB_PROVIDER === "string" ? normalizeWebProvider(env.XEQ_WEB_PROVIDER) : null;
  const store = await readAuthStore();

  const chooseSavedProvider = (): SupportedWebProvider | null => {
    if (store.defaultWebProvider && store.webProviders[store.defaultWebProvider]) {
      return store.defaultWebProvider;
    }

    return (
      SUPPORTED_WEB_PROVIDERS.find((provider) => Boolean(store.webProviders[provider])) ?? null
    );
  };

  if (explicitProvider) {
    const envKey = getWebEnvKey(explicitProvider, env);
    if (envKey) {
      env.XEQ_WEB_PROVIDER = explicitProvider;
      return {
        provider: explicitProvider,
        authSource: "env",
        apiKey: envKey,
      };
    }

    const savedKey = store.webProviders[explicitProvider]?.key;
    if (savedKey) {
      env.XEQ_WEB_PROVIDER = explicitProvider;
      env[webProviderEnvVar(explicitProvider)] = savedKey;
      return {
        provider: explicitProvider,
        authSource: "saved",
        apiKey: savedKey,
      };
    }

    return null;
  }

  for (const provider of SUPPORTED_WEB_PROVIDERS) {
    const envKey = getWebEnvKey(provider, env);
    if (!envKey) continue;
    env.XEQ_WEB_PROVIDER = provider;
    return {
      provider,
      authSource: "env",
      apiKey: envKey,
    };
  }

  const savedProvider = chooseSavedProvider();
  if (!savedProvider) return null;

  const savedKey = store.webProviders[savedProvider]?.key;
  if (!savedKey) return null;

  env.XEQ_WEB_PROVIDER = savedProvider;
  env[webProviderEnvVar(savedProvider)] = savedKey;
  return {
    provider: savedProvider,
    authSource: "saved",
    apiKey: savedKey,
  };
}

export function clearProviderEnv(
  provider: SupportedProvider,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env[providerEnvVar(provider)] = undefined;
  if (provider === "gemini") {
    env.GOOGLE_GENERATIVE_AI_API_KEY = undefined;
  }
  env.XEQ_PROVIDER = undefined;
  env.AGENT_MODEL = undefined;
}

export function clearWebProviderEnv(
  provider: SupportedWebProvider,
  env: NodeJS.ProcessEnv = process.env,
): void {
  env[webProviderEnvVar(provider)] = undefined;
  env.XEQ_WEB_PROVIDER = undefined;
}
