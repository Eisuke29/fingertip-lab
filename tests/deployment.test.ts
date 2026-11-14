import { describe, expect, it } from 'vitest';
import { buildAppHref } from '../src/deployment';

describe('local and GitHub Pages URLs', () => {
  it('keeps local routes on the server root', () => {
    expect(buildAppHref('/', false, 'product', 'lab')).toBe('/?room=lab');
    expect(buildAppHref('/', false, 'tracker', 'lab')).toBe('/tracker?room=lab');
  });
  it('keeps both Pages views inside the repository path without relying on SPA rewrites', () => {
    expect(buildAppHref('/fingertip-lab/', true, 'product', 'study01')).toBe('/fingertip-lab/?room=study01');
    expect(buildAppHref('/fingertip-lab/', true, 'tracker', 'study01')).toBe('/fingertip-lab/?view=tracker&room=study01');
  });
});
