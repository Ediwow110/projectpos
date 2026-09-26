// Intentionally empty network behavior.
//
// Some browsers retain a localhost service-worker registration between local
// development sessions and request /sw.js automatically. Serving a tiny,
// fetch-free worker prevents that request from compiling Next's 404 route and
// never intercepts application traffic.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
