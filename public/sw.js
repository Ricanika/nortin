// Service worker mínimo: só torna o app instalável (Chrome/Edge pedem um).
// Não guarda nada em cache: tudo continua vindo da internet, sempre atualizado.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
