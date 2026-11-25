/// <reference types="vite/client" />

declare global {
  interface Window {
    astro: import('./api').AstroApi
  }
}
