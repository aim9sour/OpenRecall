import { defineConfig } from "vite";
import {
  loopbackOrigin,
  resolveE2ePorts,
} from "../../tests/e2e/ports.js";

const e2ePorts = resolveE2ePorts();

export default defineConfig({
  preview: {
    host: "127.0.0.1",
    port: e2ePorts.web[3],
    strictPort: true,
    proxy: {
      "/api": {
        target: loopbackOrigin(e2ePorts.api[3]),
        changeOrigin: true,
      },
    },
  },
});
