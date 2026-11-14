import { buildAppHref, isStaticDemo } from './deployment';
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
export const roomName = () => { const r = new URLSearchParams(location.search).get('room') || 'lab'; return /^[a-zA-Z0-9_-]{1,32}$/.test(r) ? r : 'lab'; };
export const href = (view: 'product' | 'tracker' | 'dev') => buildAppHref(import.meta.env.BASE_URL, isStaticDemo, view, roomName());
export const isDeveloper = () => new URLSearchParams(location.search).get('dev') === '1';
export const rotation = () => ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) + 360) % 360;

/** Labeled range slider. The output element is `${id}-out`. */
export function slider(id: string, label: string, min: number, max: number, value: number, step = 1, unit = '°', hint = '') {
  return `<div class="slider"><label class="slider-label" for="${id}"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><output id="${id}-out">${value}${unit}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/></div>`;
}
/** iOS-style switch backed by a real checkbox. */
export function toggle(id: string, label: string, checked = false, hint = '') {
  return `<label class="switch-row" for="${id}"><span class="switch-text">${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" class="switch" id="${id}" ${checked ? 'checked' : ''}/></label>`;
}

const paths: Record<string, string> = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  camera: '<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.01"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  press: '<circle cx="12" cy="15" r="6"/><path d="M12 2v6"/><path d="M9 5.5L12 8.5l3-3"/>',
  release: '<circle cx="12" cy="16" r="5"/><path d="M12 11c0-3 1-5 0-8" stroke-dasharray="2 2"/><circle cx="12" cy="3" r="1.2" fill="currentColor"/>',
  stroke: '<circle cx="12" cy="13" r="7"/><path d="M8 13h8"/><path d="M14 11l2 2-2 2"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>',
};
export const icon = (name: keyof typeof paths | string, size = 18) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;

export type Stage = [label: string, value: string, state: 'ok' | 'wait' | 'off' | 'skip'];
export function renderPipeline(el: HTMLElement, stages: Stage[]) {
  const html = stages.map(([label, value, state]) => `<li data-state="${state}"><span class="pl-label">${label}</span><span class="pl-value">${value}</span></li>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}
export function renderReadouts(el: HTMLElement, cells: [string, string][]) {
  const html = cells.map(([k, val]) => `<div><span>${k}</span><strong>${val}</strong></div>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}
/** Set text/attribute only when changed, to avoid layout churn in animation loops. */
export function setText(el: HTMLElement, text: string) { if (el.textContent !== text) el.textContent = text; }
export function setData(el: HTMLElement, key: string, value: string) { if (el.dataset[key] !== value) el.dataset[key] = value; }
