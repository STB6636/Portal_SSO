import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  plugins: [react() as any, tailwindcss() as any],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      exceljs: path.resolve(__dirname, './node_modules/exceljs/dist/exceljs.min.js'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router')
          ) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'vendor-supabase';
          }
          if (id.includes('node_modules/@tanstack')) {
            return 'vendor-tanstack';
          }
          if (id.includes('node_modules/sweetalert2')) {
            return 'vendor-swal';
          }
          if (id.includes('node_modules/chart.js') || id.includes('node_modules/react-chartjs-2')) {
            return 'vendor-chart';
          }
          if (id.includes('node_modules/exceljs')) {
            return 'vendor-exceljs';
          }
          if (id.includes('node_modules/papaparse')) {
            return 'vendor-papaparse';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
  },
});
