import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'desktop-content-security-policy',
      transformIndexHtml: () => [{
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: `default-src 'self'; script-src 'self'${command === 'serve' ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src ${command === 'serve' ? "'self' ws://127.0.0.1:5173" : "'none'"}; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`,
        },
        injectTo: 'head-prepend',
      }],
    },
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
}));
