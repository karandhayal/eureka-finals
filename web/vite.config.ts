import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  // BASE=/eureka-finals/ builds the app for a sub-folder of another site.
  base: process.env.BASE || '/',
  plugins: [react()],
  build: { target: 'es2019', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5173 },
});
