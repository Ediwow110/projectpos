import { defineConfig } from "vitest/config";

// Phase 12: pg-backed parity tests. They share one disposable database, so
// file parallelism is off. Requires the docker-compose database:
//   docker compose -f docker/docker-compose.yml up -d db
export default defineConfig({
  test: {
    include: ["test/pg/**/*.test.ts"],
    globalSetup: ["./test/pg/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
