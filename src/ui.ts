import { buildAppHref, isStaticDemo } from './deployment';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};
export const roomName = () => {
  const name = new URLSearchParams(location.search).get('room') || 'lab';
  return /^[a-zA-Z0-9_-]{1,32}$/.test(name) ? name : 'lab';
};
export const appHref = (view: 'product' | 'tracker') => buildAppHref(import.meta.env.BASE_URL, isStaticDemo, view, roomName());
export function header(tracker = false) {
  return `<header class="topbar"><a class="brand" href="${appHref('product')}"><i class="brand-mark" aria-hidden="true"></i>fingertip<small>INTERACTION LAB</small></a>
    <nav class="topnav" aria-label="画面切り替え"><span id="connection" class="connection">中継に接続中</span>
    <a href="${appHref(tracker ? 'product' : 'tracker')}">${tracker ? '商品画面 ↗' : 'PC 追跡画面 ↗'}</a></nav></header>`;
}
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(message: string) {
  let element = document.getElementById('toast');
  if (!element) { element = document.createElement('div'); element.id = 'toast'; element.className = 'toast'; element.setAttribute('role', 'status'); document.body.appendChild(element); }
  element.textContent = message; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element!.hidden = true; }, 4000);
}
export async function networkLinks(target: HTMLElement, tracker = false) {
  if (isStaticDemo) {
    target.textContent = '背面カメラ操作は、リポジトリのREADMEに沿ってPCで起動してください。';
    return;
  }
  try {
    const response = await fetch('/api/network');
    const data = await response.json();
    target.replaceChildren();
    const urls: string[] = data.urls;
    if (!urls.length) { target.textContent = 'LANアドレスがありません。PCをWi-Fiに接続してください。'; return; }
    for (const base of urls) {
      const link = document.createElement('a');
      const url = new URL(tracker ? '/tracker' : '/', base);
      url.searchParams.set('room', roomName());
      link.href = url.toString(); link.textContent = url.toString(); target.appendChild(link);
    }
  } catch { target.textContent = '起動したターミナルの LAN phone のアドレスを確認してください。'; }
}
