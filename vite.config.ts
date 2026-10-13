import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: process.env.VITE_NATIVE_APP_ROLE ? '.android-public' : 'public',
})
