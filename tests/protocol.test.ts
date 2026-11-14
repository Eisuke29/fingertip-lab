import { describe, expect, it, vi } from 'vitest';
import { validControl } from '../server/protocol.mjs';
import { csvCell } from '../src/records';
import { newId } from '../src/types';

const packet = { type: 'control', version: 1, seq: 0, value: 0.5, valid: true, calibrated: true, confidence: 1, source: 'camera', sentAt: 1 };
describe('network frame validation', () => {
  it('accepts calibrated camera and explicitly identified simulation frames', () => {
    expect(validControl(packet)).toBe(true); expect(validControl({ ...packet, source: 'simulation' })).toBe(true);
  });
  it('rejects malformed and non-finite input rather than forwarding it', () => {
    for (const change of [{ value: NaN }, { value: 1.5 }, { seq: -1 }, { seq: 0.5 }, { valid: 'yes' }, { source: 'imu' }, { confidence: Infinity }])
      expect(validControl({ ...packet, ...change })).toBe(false);
  });
});
describe('CSV encoding', () => {
  it('quotes commas, quotes, and newlines and prevents text formulas', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'); expect(csvCell('=1+1')).toBe("'=1+1"); expect(csvCell(0.75)).toBe('0.75');
  });
});

describe('ordinary HTTP support', () => {
  it('creates IDs when randomUUID is unavailable outside a secure context', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      const a = newId(), b = newId();
      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(a).not.toBe(b);
    } finally { vi.unstubAllGlobals(); }
  });
});
