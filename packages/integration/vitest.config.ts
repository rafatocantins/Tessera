import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 120_000,   // 2 min per test — services can be slow to respond
    hookTimeout: 180_000,   // 3 min for globalSetup (docker compose up + wait for gateway)
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },  // serial execution — shared Docker stack
    },
    globalSetup: ["src/setup/global-setup.ts"],
    include: ["src/tests/**/*.test.ts"],
  },
});
