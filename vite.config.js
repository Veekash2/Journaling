import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is hosted on GitHub Pages at /Journaling/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Journaling/' : '/',
  plugins: [react()],
}))
