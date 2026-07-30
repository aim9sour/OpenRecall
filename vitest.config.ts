import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "packages/**/*.test.ts",
            "apps/server/**/*.test.ts",
            "tests/ci/**/*.test.ts",
            "tests/documentation/**/*.test.ts",
            "tests/security/**/*.test.ts",
          ],
          setupFiles: ["tests/security/network-fence.ts"],
        },
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          include: ["apps/web/**/*.test.ts", "apps/web/**/*.test.tsx"],
          setupFiles: ["apps/web/src/test/setup.ts"],
        },
      },
    ],
  },
});
