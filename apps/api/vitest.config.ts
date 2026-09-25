import { defineConfig } from "vitest/config";

// Default suite: the memory-backed tests, runnable anywhere with no Docker.
// The PostgreSQL parity tests live in their own config (`pnpm test:pg`,
// vitest.pg.config.ts) because they need the docker-compose database.
export default defineConfig({
  test: {
    exclude: ["test/pg/**", "**/node_modules/**"],
  },
});
