import { repositoryUrl } from './deployment';
import { $, appHref, header } from './ui';

export function startStaticTracker() {
  $('app').innerHTML = `${header(true)}<main class="shell"><div class="intro"><div><p class="eyebrow">PC CAMERA / LOCAL SERVER</p><h1>背面の操作は、PCで。</h1><p>公開デモでは、表面タッチ・比較試行・CSV保存を試せます。</p></div></div>
  <section class="panel" style="max-width:720px"><h2>PCカメラとスマホをつなぐ</h2>
  <p style="margin-top:12px">背面の曲げ戻しを使うには、リポジトリをPCへダウンロードし、サーバーを起動してください。</p>
  <pre class="link-box">npm install<br/>npm run dev</pre>
  <p class="small-text" style="margin-top:12px">PCで <code>http://localhost:5173/tracker</code> を開き、3色の目印と姿勢を記録します。スマホは同じWi-Fiから、ターミナルに表示されるLANアドレスを開きます。</p>
  <p class="field-note">GitHub Pagesには操作量の中継サーバーがないため、この公開URLではカメラを起動しません。</p>
  <div style="display:flex;gap:20px;margin-top:20px;flex-wrap:wrap"><a href="${repositoryUrl}#起動">PCでの起動手順 ↗</a><a href="${appHref('product')}">表面タッチのデモへ戻る →</a></div></section></main>`;
  $('connection').textContent = '公開デモ';
}
