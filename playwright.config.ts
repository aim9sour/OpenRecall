import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/start-server.ts",
      url: "http://127.0.0.1:3210/api/v1/bootstrap",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @openrecall/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx tests/e2e/start-english-server.ts",
      url: "http://127.0.0.1:3211/api/v1/bootstrap",
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web exec vite --config vite.e2e-en.config.ts",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium-ar",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5173",
      },
    },
    {
      name: "chromium-en",
      testMatch: /management-statistics\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5174",
      },
    },
  ],
});
