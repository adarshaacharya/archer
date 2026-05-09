const aiSdkGlobal = globalThis as typeof globalThis & {
  AI_SDK_LOG_WARNINGS?: boolean;
};

aiSdkGlobal.AI_SDK_LOG_WARNINGS = false;

export {};
