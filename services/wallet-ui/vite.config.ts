import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@kit": path.resolve(__dirname, "../ui-kit/src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5175,
  },
});
