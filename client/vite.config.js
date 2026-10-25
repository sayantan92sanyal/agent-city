import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // 127.0.0.1 (not `localhost`) because the backend binds IPv4 loopback
        // only; changeOrigin rewrites Host to 127.0.0.1:4317, which the
        // backend's Host check allows.
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
