import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the frontend runs on Vite's own port (5173) while the backend
// (serial + WebSocket) runs on 8000 - proxy both so the browser only ever
// talks to one origin. In production the backend serves the built frontend
// directly, so no proxy is needed there.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/api': { target: 'http://localhost:8000' },
    },
  },
});
