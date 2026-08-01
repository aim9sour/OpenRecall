import { defineConfig, devices } from "@playwright/test";
import {
  loopbackOrigin,
  resolveE2ePorts,
} from "./tests/e2e/ports.js";

const e2ePorts = resolveE2ePorts();

const requestedBrowserChannel =
  process.env["OPENRECALL_BROWSER_CHANNEL"];
if (
  requestedBrowserChannel !== undefined &&
  requestedBrowserChannel !== "chrome"
) {
  throw new Error(
    "OPENRECALL_BROWSER_CHANNEL must be unset or equal to chrome",
  );
}
const brandedBrowser =
  requestedBrowserChannel === "chrome"
    ? { channel: "chrome" as const }
    : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"] ? "github" : "list",
  use: {
    baseURL: loopbackOrigin(e2ePorts.web[0]),
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec tsx tests/e2e/start-server.ts",
      url: `${loopbackOrigin(e2ePorts.api[0])}/api/v1/bootstrap`,
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web exec vite --config vite.e2e-ar.config.ts",
      url: loopbackOrigin(e2ePorts.web[0]),
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx tests/e2e/start-english-server.ts",
      url: `${loopbackOrigin(e2ePorts.api[1])}/api/v1/bootstrap`,
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web exec vite --config vite.e2e-en.config.ts",
      url: loopbackOrigin(e2ePorts.web[1]),
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx tests/e2e/start-pseudo-server.ts",
      url: `${loopbackOrigin(e2ePorts.api[2])}/api/v1/bootstrap`,
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web exec vite --config vite.e2e-xa.config.ts",
      url: loopbackOrigin(e2ePorts.web[2]),
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx tests/e2e/start-pwa-server.ts",
      url: `${loopbackOrigin(e2ePorts.api[3])}/api/v1/bootstrap`,
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web build && pnpm --filter @openrecall/web exec vite preview --config vite.e2e-pwa.config.ts",
      url: loopbackOrigin(e2ePorts.web[3]),
      reuseExistingServer: false,
    },
    {
      command: "pnpm exec tsx tests/e2e/start-optimizer-server.ts",
      url: `${loopbackOrigin(e2ePorts.api[4])}/api/v1/bootstrap`,
      reuseExistingServer: false,
    },
    {
      command:
        "pnpm --filter @openrecall/web exec vite --config vite.e2e-optimizer.config.ts",
      url: loopbackOrigin(e2ePorts.web[4]),
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium-ar",
      testIgnore: /(optimizer-durability|pwa)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...brandedBrowser,
        baseURL: loopbackOrigin(e2ePorts.web[0]),
      },
    },
    {
      name: "chromium-en",
      testMatch:
        /(management-statistics|visual-accessibility)\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...brandedBrowser,
        baseURL: loopbackOrigin(e2ePorts.web[1]),
      },
    },
    {
      name: "chromium-xa",
      testMatch: /visual-accessibility\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...brandedBrowser,
        baseURL: loopbackOrigin(e2ePorts.web[2]),
      },
    },
    {
      name: "chromium-pwa",
      testMatch: /pwa\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...brandedBrowser,
        baseURL: loopbackOrigin(e2ePorts.web[3]),
      },
    },
    {
      name: "chromium-optimizer",
      testMatch: /optimizer-durability\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        ...brandedBrowser,
        baseURL: loopbackOrigin(e2ePorts.web[4]),
      },
    },
  ],
});
