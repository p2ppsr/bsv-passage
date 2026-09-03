import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'build',
    sourcemap: true,
  },
  server: {
    host: '::',
    port: 8080,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
