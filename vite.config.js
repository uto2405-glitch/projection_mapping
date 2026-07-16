import { defineConfig } from "vite";

// 채점 계약: npm run dev → http://localhost:5173 (포트 고정)
export default defineConfig({
  server: { port: 5173, strictPort: true, host: true },
});
