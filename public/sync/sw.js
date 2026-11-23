// Kill switch for the old service worker (removed in the Fable review P0-5).
// iPads / iPhones that installed the old one keep showing cached old pages until it is replaced:
// this version deletes every cache, unregisters itself and reloads the open pages from the PC.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
})()));
