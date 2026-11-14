import './style.css';
import { isStaticDemo, repositoryUrl } from './deployment';
import { $, href } from './ui';
async function boot() {
  const tracker = location.pathname.replace(/\/$/, '') === '/tracker' || new URLSearchParams(location.search).get('view') === 'tracker';
  if (tracker && isStaticDemo) {
    $('app').innerHTML = `<main class="static-info"><p class="overline">PIVOT / CAMERA</p><h1>実指の計測は、PCで。</h1><p>PCでサーバーを起動し、localhostの追跡画面で姿勢を校正します。スマホは同じWi-FiのLANアドレスを開きます。</p><pre>npm install\nnpm run dev</pre><p>公開ページでは、開発画面から同じレンダラーへ再生用の姿勢を入力できます。</p><a href="${href('dev')}">描画を確認する →</a><a href="${repositoryUrl}#pcから起動する">PC起動の手順 ↗</a></main>`;
  } else if (tracker) { const { startTracker } = await import('./tracker'); startTracker(); }
  else { const { startExperience } = await import('./experience'); startExperience(); }
}
boot().catch(error => {
  console.error(error); $('app').replaceChildren();
  const text = document.createElement('p'); text.className = 'fatal'; text.textContent = `起動できませんでした。WebGL 2対応ブラウザーで開いてください。 ${error instanceof Error ? error.message : error}`; $('app').appendChild(text);
});
