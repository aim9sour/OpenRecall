import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);
const { VitePWA } = require("vite-plugin-pwa") as {
  readonly VitePWA: (options: unknown) => Plugin;
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      injectRegister: false,
      selfDestroying: true,
      manifest: {
        name: "OpenRecall",
        short_name: "OpenRecall",
        description:
          "A private, local-first spaced-repetition study application.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#103d32",
        background_color: "#f2f7f4",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5_173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3210",
        changeOrigin: true,
      },
    },
  },
});
