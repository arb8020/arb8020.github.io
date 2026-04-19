import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { browserLogPlugin } from './vite-plugin-browser-log'

export default defineConfig(({ command }) => ({
  plugins: [react(), browserLogPlugin()],
  base: command === 'build' ? '/annotate-resize/dist/' : '/',
  build: { outDir: 'dist' },
}))
