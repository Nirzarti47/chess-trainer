import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // Время сборки показывается в «О приложении»: по нему видно, какая версия установлена.
  // Номер коммита приходит из окружения выкладки (VITE_BUILD_COMMIT в deploy.yml).
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // Новая версия ждёт, пока пользователь нажмёт «Обновить» (UpdateBanner).
      registerType: 'prompt',
      // Регистрирует сервис-воркер хук useRegisterSW из virtual:pwa-register/react.
      injectRegister: false,
      // Значки уже попадают в предзагрузку по globPatterns; без этого они попали бы туда дважды.
      includeManifestIcons: false,
      manifest: {
        name: 'Шахматный тренажёр',
        short_name: 'Шахматы',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#16222C',
        theme_color: '#16222C',
        // Относительные пути: приложение живёт в подкаталоге GitHub Pages.
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Всё, что приложение загружает: оболочка, шрифт, фигуры, задачи, движок, значки.
        globPatterns: ['**/*.{html,js,css,woff2,svg,png,json,wasm,txt}'],
        // Самый крупный файл задач около 3,5 МБ, движок около 1,85 МБ.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        // Первый сервис-воркер сразу берёт страницу под управление;
        // следующие версии всё равно ждут «Обновить» (skipWaiting не включён).
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
