import { buildAppHref, isStaticDemo } from './deployment';
export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
export const roomName = () => { const r = new URLSearchParams(location.search).get('room') || 'lab'; return /^[a-zA-Z0-9_-]{1,32}$/.test(r) ? r : 'lab'; };
export const href = (view: 'product' | 'tracker' | 'dev') => buildAppHref(import.meta.env.BASE_URL, isStaticDemo, view, roomName());
export const isDeveloper = () => new URLSearchParams(location.search).get('dev') === '1';
export const rotation = () => ((screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) + 360) % 360;
export function slider(id: string, label: string, min: number, max: number, value: number, step = 1, unit = '°') {
  return `<label class="slider-label" for="${id}"><span>${label}</span><output id="${id}-out">${value}${unit}</output></label><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"/>`;
}

export type Stage = [label: string, value: string, state: 'ok' | 'wait' | 'off' | 'skip'];
export function renderPipeline(el: HTMLElement, stages: Stage[]) {
  const html = stages.map(([label, value, state]) => `<li data-state="${state}"><span class="pl-label">${label}</span><span class="pl-value">${value}</span></li>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}
export function renderReadouts(el: HTMLElement, cells: [string, string][]) {
  const html = cells.map(([k, val]) => `<div><span>${k}</span><strong>${val}</strong></div>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
}
