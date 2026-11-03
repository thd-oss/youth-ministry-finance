import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/youth-ministry-finance/',
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 4820,
    strictPort: true,
  },
});
