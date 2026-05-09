import type {
  WebAction,
  WebActionResult,
} from "@archer/shared/web";
import type { WebCapability } from "@archer/tools";
import { findInPage, openPage } from "./internal/page.js";
import { searchArcherScout } from "./internal/providers/archer-scout.js";
import { searchExa } from "./internal/providers/exa.js";
import { searchTavily } from "./internal/providers/tavily.js";

export type SupportedWebProvider = "tavily" | "exa" | "archer-scout";

export type ActiveWebConfig = {
  provider: SupportedWebProvider;
  apiKey: string;
};

export type WebPermissions = {
  allowUrl(url: string): Promise<void>;
};

export function createWebCapability(
  resolveConfig: () => Promise<ActiveWebConfig>,
  permissions?: WebPermissions,
): WebCapability {
  return {
    async execute(action: WebAction): Promise<WebActionResult> {
      switch (action.type) {
        case "search": {
          const config = await resolveConfig();
          switch (config.provider) {
            case "exa":
              return searchExa(config.apiKey, action);
            case "archer-scout":
              return searchArcherScout(action);
            default:
              return searchTavily(config.apiKey, action);
          }
        }
        case "openPage":
          return openPage(action, permissions);
        case "findInPage":
          return findInPage(action, permissions);
      }
    },
  };
}
