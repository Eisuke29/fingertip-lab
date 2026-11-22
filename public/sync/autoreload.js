// When the page files on the PC change (a fix was made), open pages reload themselves, so the iPad / iPhone / PC
// never keep running an old version. Compares the content of the page files every 3 s (works with any server).
const FILES = ['phone.js', 'ipad.js', 'monitor.js', 'tracker.js', 'geom.js', 'ring.js', 'wslink.js', 'pattern.js', 'display.js', 'autoreload.js', 'version.js', 'phone.html', 'ipad.html', 'monitor.html'];
export function autoReload(beforeReload) {
  if (/github\.io$/.test(location.hostname)) return;
  let v0 = null;
  const check = async () => {
    try {
      let h = 0;
      for (const f of FILES) { const t = await (await fetch(new URL(f, location.href), { cache: 'no-store' })).text(); for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; }
      if (v0 == null) v0 = h; else if (h !== v0) { beforeReload?.(); location.reload(); }
    } catch {}
  };
  check(); setInterval(check, 3000);
}
