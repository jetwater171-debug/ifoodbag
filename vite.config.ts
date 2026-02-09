import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const pages = [
  'index',
  'quiz',
  'dados',
  'endereco',
  'processando',
  'sucesso',
  'checkout',
  'orderbump',
  'pix',
  'admin',
  'admin-tracking',
  'admin-utmfy',
  'admin-pages',
  'admin-leads'
];

const input = Object.fromEntries(
  pages.map((name) => [name, resolve(__dirname, `${name}.html`)])
);

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { input }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'https://mfmbuxbmslukkaxpdprw.supabase.co/functions/v1/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
});
