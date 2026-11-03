import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Production-only: the dev server injects an inline React refresh script that this policy would block.
// img-src allows https: for GitHub avatars and user-provided cover art; scripts never load from outside the app.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.github.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'anyps5-csp',
      apply: 'build',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
      ],
    },
  ],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/dist/**', '**/dist-electron/**', '**/dist-installer/**', '**/*.tmp/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
