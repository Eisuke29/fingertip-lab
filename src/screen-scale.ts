/** CSS pixels per millimetre for common devices, so the virtual finger is drawn at real size. */
export type ScalePreset = 'auto' | 'ipad' | 'ipad-mini' | 'iphone' | 'pc' | 'custom';
export const scalePresets: { id: ScalePreset; label: string; pxPerMm?: number }[] = [
  { id: 'auto', label: '自動（端末から判定）' },
  // iPad / Air / Pro (11", 13") all render 132 CSS px per inch.
  { id: 'ipad', label: 'iPad・iPad Air・iPad Pro', pxPerMm: 132 / 25.4 },
  { id: 'ipad-mini', label: 'iPad mini', pxPerMm: 163 / 25.4 },
  { id: 'iphone', label: 'iPhone', pxPerMm: 6.04 },
  { id: 'pc', label: 'PCの画面（目安）', pxPerMm: 96 / 25.4 },
  { id: 'custom', label: '手動で合わせる' },
];
/** Guess the device. A mouse-driven PC previews at iPad size, since the iPad is the target display. */
export function detectPreset(): Exclude<ScalePreset, 'auto' | 'custom'> {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const short = Math.min(screen.width, screen.height);
  if (!coarse) return 'ipad';
  if (short >= 800) return 'ipad';
  if (short >= 700) return 'ipad-mini';
  return 'iphone';
}
export function resolvePxPerMm(preset: ScalePreset, custom: number) {
  if (preset === 'custom') return custom;
  const id = preset === 'auto' ? detectPreset() : preset;
  return scalePresets.find(p => p.id === id)!.pxPerMm!;
}
export const presetLabel = (preset: ScalePreset) => scalePresets.find(p => p.id === (preset === 'auto' ? detectPreset() : preset))?.label ?? '';
