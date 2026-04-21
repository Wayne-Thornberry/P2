import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { version } from './package.json'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
  ],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['src/**/__tests__/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/stores/**'],
      reporter: ['text', 'lcov'],
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  base: '/P2/', 
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
})
