import { defineConfig } from 'vite'
import laravel from 'laravel-vite-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.tsx'],
            ssr: 'resources/js/ssr.tsx',
            refresh: true,
            // Sin `fonts:` a propósito. El scaffolding traía Instrument Sans
            // servida por Bunny; la identidad de Goliath es Roboto Condensed y se
            // sirve desde public/brand/fonts (cuatro .woff2 propios). Nada de
            // peticiones a terceros: ni excepción en la CSP ni dependencia de un
            // CDN para que el sitio se vea bien.
        }),
        react(),
        tailwindcss(),
    ],
    resolve: {
        alias: {
            '@': '/resources/js',
        },
    },
    server: {
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
})
