import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// MTL Console — Vite konfigürasyonu
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    server: {
        port: 5173,
        host: "0.0.0.0",
        proxy: {
            // Dev modda API proxy — master backend'e
            "/api": {
                target: process.env.VITE_API_TARGET || "https://mtl-master-01.mtl.local",
                changeOrigin: true,
                secure: false,
            },
        },
    },
    build: {
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'ui-vendor': ['lucide-react', 'sonner', 'zustand'],
                    'form-vendor': ['react-hook-form', '@hookform/resolvers', 'zod'],
                },
            },
        },
        outDir: "dist",
        sourcemap: true,
        target: "es2022",
    },
});
