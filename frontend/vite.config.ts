import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'pwa-*.png'],
      manifest: {
        name: 'HexaLLM AI Platform',
        short_name: 'HexaLLM AI',
        description: 'Open-source AI hub — chat, agents, image gen, and more',
        theme_color: '#121626',
        background_color: '#121626',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-72.png',  sizes: '72x72',   type: 'image/png' },
          { src: 'pwa-96.png',  sizes: '96x96',   type: 'image/png' },
          { src: 'pwa-128.png', sizes: '128x128', type: 'image/png' },
          { src: 'pwa-144.png', sizes: '144x144', type: 'image/png' },
          { src: 'pwa-152.png', sizes: '152x152', type: 'image/png' },
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'pwa-384.png', sizes: '384x384', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — always needed
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // State + HTTP — always needed
          'vendor-core': ['zustand', 'axios'],
          // Heavy visualisation libs — only on Analytics/Dashboard pages
          'vendor-charts': ['recharts'],
          // Markdown + code highlighting — only on Chat/Share pages
          'vendor-markdown': ['react-markdown', 'react-syntax-highlighter'],
          // Icons — split off so it can be cached independently
          'vendor-icons': ['lucide-react'],
        },
      },
    },
    // Better source-map free minification
    minify: 'esbuild',
    // Raise the inline-asset threshold so tiny SVGs go inline
    assetsInlineLimit: 4096,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
