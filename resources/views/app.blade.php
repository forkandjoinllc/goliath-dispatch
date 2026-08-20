<!DOCTYPE html>
<html lang="{{ $page['props']['localeTag'] ?? 'en-US' }}" class="scroll-smooth">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#062B5C">

    {{-- Los favicons y las fuentes salen de public/brand: nada de terceros. --}}
    <link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/brand/favicon-32.png" sizes="32x32">
    <link rel="apple-touch-icon" href="/brand/favicon-180.png">

    {{-- Precarga solo los dos pesos que se usan sobre el pliegue. Precargar los
         cuatro competiría por ancho de banda con el CSS. --}}
    <link rel="preload" href="/brand/fonts/roboto-condensed-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/brand/fonts/roboto-condensed-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>

    @routes
    @viteReactRefresh
    @vite(['resources/css/app.css', 'resources/js/app.tsx'])
    @inertiaHead
</head>
<body class="min-h-dvh bg-white font-body text-carbon antialiased">
    @inertia
</body>
</html>
