import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.indexOf("node_modules") === -1) return;
          if (id.indexOf("monaco-editor") !== -1 || id.indexOf("@monaco-editor/react") !== -1) {
            return "monaco";
          }
          if (id.indexOf("echarts") !== -1 || id.indexOf("echarts-for-react") !== -1) {
            return "charts";
          }
          if (id.indexOf("react-markdown") !== -1 || id.indexOf("remark-gfm") !== -1) {
            return "markdown";
          }
        },
      },
    },
  },
  server: {
    port: 1420,
    host: "127.0.0.1"
  }
});
