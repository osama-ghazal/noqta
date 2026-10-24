import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: 'web',
  envDir: here,
  // Only the client id reaches the browser (index.html %NOQTA_CLIENT_ID%); the secret never does.
  envPrefix: ['VITE_', 'NOQTA_CLIENT_ID'],
  plugins: [vue()],
  build: { outDir: '../dist/web', emptyOutDir: true }
})
