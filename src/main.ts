import './style.css';
import { isStaticDemo, repositoryUrl } from './deployment';
import { $, href } from './ui';
async function boot() {
  const tracker = location.pathname.replace(/\/$/, '') === '/tracker' || new URLSearchParams(location.search).get('view') === 'tracker';
  if (tracker && isStaticDemo) {
    $('app').innerHTML = `<main class="static-info"><p class="eyebrow">Pivot Finger Lab</p><h1>「指の読み取り」はPCで起動して使います</h1><p class="meta">公開版ではカメラでの読み取りとiPhoneへの送信を使えません。PCのこのフォルダで次を実行し、<code>http://localhost:5173/tracker</code> を開きます。</p><pre>npm ci
npm run dev</pre><p class="links"><a class="pill-link" href="${href('dev')}">「調整・お試し」で手動で動かす</a><a class="pill-link" href="${repositoryUrl}#pcから起動する">起動手順 ↗</a></p></main>`;
  } else if (tracker) { const { startTracker } = await import('./tracker'); startTracker(); }
  else { const { startExperience } = await import('./experience'); startExperience(); }
}
boot().catch(error => {
  console.error(error); $('app').replaceChildren();
  const text = document.createElement('p'); text.className = 'fatal'; text.textContent = `起動できませんでした。WebGL 2対応ブラウザーで開いてください。 ${error instanceof Error ? error.message : error}`; $('app').appendChild(text);
});
