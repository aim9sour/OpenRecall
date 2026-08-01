import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config.js";
import {
  loopbackOrigin,
  resolveE2ePorts,
} from "../../tests/e2e/ports.js";

const e2ePorts = resolveE2ePorts();

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      host: "127.0.0.1",
      port: e2ePorts.web[4],
      strictPort: true,
      proxy: {
        "/api": {
          target: loopbackOrigin(e2ePorts.api[4]),
          changeOrigin: true,
        },
      },
    },
  }),
);
