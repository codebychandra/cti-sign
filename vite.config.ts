import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed to Cloudflare Workers static assets (see wrangler.toml), served at
// the domain root. Override with VITE_BASE only if that ever changes.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
