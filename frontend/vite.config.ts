import dns from 'node:dns';
// Le proxy de dev tentait IPv6 en premier (timeouts) : forcer IPv4.
dns.setDefaultResultOrder('ipv4first');
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Le dashboard ne parle jamais a Traccar directement :
      // tout passe par l'API, y compris le flux SSE.
      '/api': {
        target: 'https://fleet.noor.lu',
        changeOrigin: true,
      },
    },
  },
});
