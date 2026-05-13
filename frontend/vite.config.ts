import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/login': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        bypass: (req) => {
          const accept = req.headers?.accept ?? ''
          // Let the SPA handle browser navigations like /login
          if (typeof accept === 'string' && accept.includes('text/html')) {
            return req.url
          }
          return undefined
        },
      },
      '/refresh': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/me': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/approvals': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/audit': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/admin': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        bypass: (req) => {
          const accept = req.headers?.accept ?? ''
          // Let the SPA handle browser navigations like /admin/login
          if (typeof accept === 'string' && accept.includes('text/html')) {
            return req.url
          }
          return undefined
        },
      },
      // App API (when VITE_API_URL is unset, the SPA calls these paths on the dev server).
      '/contractor-rates': { target: 'http://localhost:8000', changeOrigin: true },
      '/contractors': { target: 'http://localhost:8000', changeOrigin: true },
      '/part-master': { target: 'http://localhost:8000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:8000', changeOrigin: true },
      '/invoices': { target: 'http://localhost:8000', changeOrigin: true },
      '/work-orders': { target: 'http://localhost:8000', changeOrigin: true },
      '/tasks': { target: 'http://localhost:8000', changeOrigin: true },
      '/dashboard': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        bypass: (req) => {
          const path = (req.url ?? '').split('?')[0] ?? ''
          // Only `/dashboard/summary` is the FastAPI route; all other `/dashboard/*` is the SPA.
          if (path === '/dashboard/summary') return undefined
          if (path.startsWith('/dashboard')) return req.url
          return undefined
        },
      },
      '/auth': { target: 'http://localhost:8000', changeOrigin: true },
      '/forgot-password': { target: 'http://localhost:8000', changeOrigin: true },
      '/reset-password': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
