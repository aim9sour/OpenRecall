import { defineConfig, mergeConfig } from "vite";
import {
  loopbackOrigin,
  resolveE2ePorts,
} from "../../tests/e2e/ports.js";
import baseConfig from "./vite.config.js";

const e2ePorts = resolveE2ePorts();

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: {
      host: "127.0.0.1",
      port: e2ePorts.web[0],
      strictPort: true,
      proxy: {
        "/api": {
          target: loopbackOrigin(e2ePorts.api[0]),
          changeOrigin: true,
        },
      },
    },
  }),
);
