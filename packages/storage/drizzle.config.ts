import os from "node:os";
import path from "node:path";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./src/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.ARCHER_DATABASE_PATH ??
      path.join(
        process.env.ARCHER_STORAGE_DIR ?? path.join(os.homedir(), ".local", "share", "archer"),
        "history.db",
      ),
  },
});
