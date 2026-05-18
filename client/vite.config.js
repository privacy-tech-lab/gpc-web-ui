import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { datasetManifest } from './vite-plugins/dataset-manifest.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), datasetManifest()],
})
