import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config.js";

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      host: "127.0.0.1",
      port: 5_175,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3212",
          changeOrigin: true,
        },
      },
    },
  }),
);
