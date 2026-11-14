import './style.css';
import { isStaticDemo } from './deployment';

async function boot() {
  const tracker = location.pathname.replace(/\/$/, '') === '/tracker' || new URLSearchParams(location.search).get('view') === 'tracker';
  if (tracker && isStaticDemo) {
    const { startStaticTracker } = await import('./static-tracker');
    startStaticTracker();
  } else if (tracker) {
    const { startTracker } = await import('./tracker');
    startTracker();
  } else {
    const { startProductApp } = await import('./product-app');
    startProductApp();
  }
}
boot().catch(error => {
  console.error(error);
  const target = document.getElementById('app')!;
  target.replaceChildren();
  const card = document.createElement('div');
  card.className = 'shell error-card';
  const title = document.createElement('h1'); title.textContent = '画面を起動できませんでした';
  const message = document.createElement('p');
  message.textContent = 'WebGL 2 が使えるブラウザーで開いてください。ブラウザーのハードウェアアクセラレーションも確認してください。';
  const detail = document.createElement('p'); detail.textContent = error instanceof Error ? error.message : String(error);
  card.append(title, message, detail); target.appendChild(card);
});
