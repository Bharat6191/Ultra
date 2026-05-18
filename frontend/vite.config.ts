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
      '/forgot-password': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/reset-password': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          bypass: (req) => {
            const accept = req.headers?.accept ?? ''

            // Let React frontend handle browser page navigation
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
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
