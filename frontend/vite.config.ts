import dns from 'node:dns';
import net from 'node:net';
// Happy Eyeballs de Node (250 ms par tentative) echoue sur les liaisons a forte latence : desactiver.
net.setDefaultAutoSelectFamily(false);
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
        target: 'https://demo.mirsad.noor.sarl',
        changeOrigin: true,
      },
    },
  },
});
