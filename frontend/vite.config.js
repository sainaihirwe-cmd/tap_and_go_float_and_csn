import { defineConfig, loadEnv } from 'vite';
const envDir = __dirname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, 'VITE_');
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000';

  return {
  root: __dirname,
  envDir,
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true }
  };
});
