export const isStaticDemo = import.meta.env.MODE === 'pages';
export const repositoryUrl = 'https://github.com/Eisuke29/fingertip-lab';

export function buildAppHref(base: string, staticDemo: boolean, view: 'product' | 'tracker' | 'dev', room: string) {
  const query = new URLSearchParams({ ...(staticDemo && view === 'tracker' ? { view: 'tracker' } : {}), ...(view === 'dev' ? { dev: '1' } : {}), room });
  return `${base}${!staticDemo && view === 'tracker' ? 'tracker' : ''}?${query}`;
}
