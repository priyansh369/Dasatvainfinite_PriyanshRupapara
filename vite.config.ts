import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "localhost",
    hmr: {
      protocol: "ws",
      host: "localhost",
      clientPort: 5173,
    },
  },
});
