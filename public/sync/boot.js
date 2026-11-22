// Start-up of every page (Fable review P0-5): remove old service workers and caches (they served old versions),
// then ask the PC server which version of the pages it is serving. The version goes with every connection.
export async function boot() {
  try { for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister(); } catch {}
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  try { return (await (await fetch('/api/version', { cache: 'no-store' })).json()).v; } catch { return 'unknown'; }
}
