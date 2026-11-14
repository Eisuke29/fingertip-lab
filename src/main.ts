import './style.css';
import { isStaticDemo, repositoryUrl } from './deployment';
import { $, href } from './ui';
async function boot() {
  const tracker = location.pathname.replace(/\/$/, '') === '/tracker' || new URLSearchParams(location.search).get('view') === 'tracker';
  if (tracker && isStaticDemo) {
    $('app').innerHTML = `<main class="static-info"><h1>計測画面</h1><p class="meta">公開版ではカメラ計測と中継を使えません。PCで起動し、<code>http://localhost:5173/tracker</code> を開きます。</p><pre>npm ci\nnpm run dev</pre><p class="links"><a href="${href('dev')}">開発画面（シミュレーション）</a><a href="${repositoryUrl}#pcから起動する">起動手順 ↗</a></p></main>`;
  } else if (tracker) { const { startTracker } = await import('./tracker'); startTracker(); }
  else { const { startExperience } = await import('./experience'); startExperience(); }
}
boot().catch(error => {
  console.error(error); $('app').replaceChildren();
  const text = document.createElement('p'); text.className = 'fatal'; text.textContent = `起動できませんでした。WebGL 2対応ブラウザーで開いてください。 ${error instanceof Error ? error.message : error}`; $('app').appendChild(text);
});
