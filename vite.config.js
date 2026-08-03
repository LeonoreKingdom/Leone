const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react').default;
const path = require('node:path');

module.exports = defineConfig({
  root: path.resolve(__dirname, 'web'),
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'public'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
});
