import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
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
    {
      command: "pnpm exec tsx tests/e2e/start-pseudo-server.ts",
      url: "http://127.0.0.1:3212/api/v1/bootstrap",
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web exec vite --config vite.e2e-xa.config.ts",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx tests/e2e/start-pwa-server.ts",
      url: "http://127.0.0.1:3213/api/v1/bootstrap",
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web build && pnpm --filter @openrecall/web exec vite preview --config vite.e2e-pwa.config.ts",
      url: "http://127.0.0.1:5176",
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx tests/e2e/start-optimizer-server.ts",
      url: "http://127.0.0.1:3214/api/v1/bootstrap",
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web exec vite --config vite.e2e-optimizer.config.ts",
      url: "http://127.0.0.1:5177",
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium-ar",
      testIgnore: /(optimizer-durability|pwa)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5173",
      },
    },
    {
      name: "chromium-en",
      testMatch:
        /(management-statistics|visual-accessibility)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5174",
      },
    },
    {
      name: "chromium-xa",
      testMatch: /visual-accessibility\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5175",
      },
    },
    {
      name: "chromium-pwa",
      testMatch: /pwa\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5176",
      },
    },
    {
      name: "chromium-optimizer",
      testMatch: /optimizer-durability\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:5177",
      },
    },
  ],
});
