import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// "@/..." alias is the import convention shadcn/ui components are written to.
// The dev proxy keeps the browser talking only to the frontend origin.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { proxy: { "/api": "http://localhost:8000" } },
});
