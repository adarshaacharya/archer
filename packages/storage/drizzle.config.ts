import os from "node:os";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./src/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.XEQ_DATABASE_PATH ??
      path.join(
        process.env.XEQ_STORAGE_DIR ?? path.join(os.homedir(), ".local", "share", "xeq"),
        "history.db",
      ),
  },
});
