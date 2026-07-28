import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "packages/**/*.test.ts",
            "apps/server/**/*.test.ts",
          ],
        },
      },
    ],
  },
});
