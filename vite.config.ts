import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from /<repo>/. Override with VITE_BASE when deploying
// to a custom domain or a differently-named repo.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/cti-sign/',
  plugins: [react()],
})
