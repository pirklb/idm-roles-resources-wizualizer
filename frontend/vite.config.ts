import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    root: './', // Verweist auf den aktuellen Ordner
    server: {
        host: true, // Ermöglicht den Zugriff über die IP-Adresse
    },
    publicDir: './public', // Stellt sicher, dass statische Assets aus dem 'public'-Ordner geladen werden
});
