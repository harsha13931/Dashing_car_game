import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        // the car physics in ../shared is used by both server and client
        fs: { allow: ['..'] },
    }
})
