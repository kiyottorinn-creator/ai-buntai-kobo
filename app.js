/* 文体工房 画面側 */
(function () {
  'use strict';
  const K = window.BuntaiKobo;
  const $ = (id) => document.getElementById(id);
  let karte = null, last = null, lastPrompt = '';

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const pct = (x) => Math.round(x * 100) + '%';

  function renderKarte(k) {
    const enders = k.enders.map((e) => `<span class="pill">${esc(e.key)} ${e.n}</span>`).join('');
    const heads = k.heads.length ? k.heads.map((h) => `<span class="pill">${esc(h.key)} ${h.n}</span>`).join('') : '<span class="note">偏りなし</span>';
    return `<div class="stats">
      <div class="stat"><b>${k.sentence_len.median}</b>字 一文の真ん中</div>
      <div class="stat"><b>${k.sentence_len.p90}</b>字 上位1割の長さ</div>
      <div class="stat"><b>${pct(k.kanji_ratio)}</b> 漢字</div>
      <div class="stat"><b>${k.comma_per_sentence}</b>個 一文の読点</div>
      <div class="stat"><b>${k.sentences}</b>文 / ${k.chars}字</div>
    </div>
    <table>
      <tr><th>よく使う文末</th><td>${enders}</td></tr>
      <tr><th>よく使う書き出し</th><td>${heads}</td></tr>
      <tr><th>敬体・常体の割合</th><td>${Object.entries(k.ender_class).sort((a, b) => b[1] - a[1]).map(([a, b]) => `<span class="pill">${esc(a)} ${b}</span>`).join('')}</td></tr>
    </table>
    <p class="note">この数字は、あなたの過去記事${k.source_count}本を機械が数えたものです。良い悪いの評価ではありません。</p>`;
  }

  $('mk').onclick = function () {
    const texts = $('past').value.split(/^\s*---\s*$/m).map((s) => s.trim()).filter(Boolean);
    if (!texts.length) { alert('過去記事を貼ってください'); return; }
    const k = K.makeKarte(texts);
    if (k.error) { $('karteOut').innerHTML = `<div class="verdict stop">${esc(k.error)}（今は${k.sentences}文）</div>`; return; }
    karte = k;
    $('karteOut').innerHTML = renderKarte(k);
    $('karteState').textContent = `カルテあり（${k.source_count}本 / ${k.chars}字）`;
    $('chk').disabled = false;
  };

  $('smpPast').onclick = function () { $('past').value = window.BUNTAI_SAMPLE_PAST || ''; };
  $('smpDraft').onclick = function () { $('draft').value = window.BUNTAI_SAMPLE_DRAFT || ''; };

  $('save').onclick = function () {
    if (!karte) { alert('先にカルテを作ってください'); return; }
    localStorage.setItem('buntai_karte', JSON.stringify(karte));
    $('karteState').textContent = 'この端末に保存しました';
  };
  $('load').onclick = function () {
    const s = localStorage.getItem('buntai_karte');
    if (!s) { alert('保存されたカルテがありません'); return; }
    karte = JSON.parse(s);
    $('karteOut').innerHTML = renderKarte(karte);
    $('karteState').textContent = `保存したカルテを読みました（${karte.source_count}本 / ${karte.chars}字）`;
    $('chk').disabled = false;
  };
  $('dl').onclick = function () {
    if (!karte) { alert('先にカルテを作ってください'); return; }
    const b = new Blob([JSON.stringify(karte, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'buntai_karte.json'; a.click();
  };

  $('chk').onclick = function () {
    const text = $('draft').value.trim();
    if (!text) { alert('下書きを貼ってください'); return; }
    const r = K.checkDraft(karte, text, { aiPhrases: window.BUNTAI_AI_PHRASES || [] });
    last = r;
    lastPrompt = K.buildPrompt(karte, r);
    const marked = r.rows.map((row) => {
      if (!row.flags.length) return esc(row.text);
      const t = row.flags[0].type;
      const cls = t === 'red' ? 'r' : t === 'yellow' ? 'y' : 'b';
      return `<mark class="${cls}">${esc(row.text)}</mark>`;
    }).join('');
    const items = r.rows.filter((x) => x.flags.length).map((row, i) => {
      const t = row.flags[0].type;
      const cls = t === 'red' ? 'r' : t === 'yellow' ? 'y' : 'b';
      return `<li><span class="tag ${cls}">${i + 1}</span>${esc(row.text.slice(0, 60))}${row.text.length > 60 ? '…' : ''}
        <span class="why">${row.flags.map((f) => esc(f.why)).join(' / ')}</span></li>`;
    }).join('');
    const n = r.rows.filter((x) => x.flags.length).length;
    const v = n === 0 ? ['go', 'カルテとのズレは見つかりませんでした。あとはあなたが読んでください。']
      : n <= 5 ? ['fix', `直す文は${n}本です。`] : ['stop', `直す文が${n}本あります。`];
    $('checkOut').innerHTML = `
      <div class="verdict ${v[0]}">${v[1]}　自分の文章との距離 ${r.distance}（0に近いほど自分に近い）</div>
      <div class="stats">
        <div class="stat"><b>${r.counts.red}</b> 赤（使わない文末）</div>
        <div class="stat"><b>${r.counts.yellow}</b> 黄（長い文・AIに多い言い回し）</div>
        <div class="stat"><b>${r.counts.blue}</b> 青（漢字が多い）</div>
        <div class="stat"><b>${r.per1000.yellow}</b> 黄/1000字</div>
      </div>
      <div class="grid2"><div class="view">${marked}</div><ul class="list">${items || '<li class="note">指摘なし</li>'}</ul></div>`;
    $('copyPrompt').disabled = n === 0;
    $('verify').disabled = n === 0;
  };

  $('copyPrompt').onclick = function () {
    navigator.clipboard.writeText(lastPrompt).then(() => { $('copyPrompt').textContent = 'コピーしました'; setTimeout(() => { $('copyPrompt').textContent = '直しの指示文をコピー'; }, 1500); });
  };

  // 数字・固有名詞の照合
  function numbersOf(s) {
    return (s.match(/[0-9０-９]+(?:[.,][0-9]+)?\s*(?:%|％|円|人|件|分|時間|日|年|月|回|個|本|倍|kg|g|ml|℃|度|字)?/g) || [])
      .map((x) => x.replace(/\s/g, ''));
  }
  $('verify').onclick = function () {
    const src = last.rows.filter((r) => r.flags.length);
    const lines = $('fixed').value.split('\n').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.replace(/^\d+[.．、)]\s*/, ''));
    const rows = [];
    let ng = 0;
    src.forEach((r, i) => {
      const after = lines[i];
      if (after === undefined) { rows.push([i + 1, r.text, '(返事なし)', 'NG']); ng++; return; }
      if (/^（削除）$|^\(削除\)$/.test(after)) { rows.push([i + 1, r.text, '（削除）', 'OK']); return; }
      const a = numbersOf(r.text).sort().join('|'), b = numbersOf(after).sort().join('|');
      const ok = a === b;
      if (!ok) ng++;
      rows.push([i + 1, r.text, after, ok ? 'OK' : 'NG 数字が変わった: ' + (a || 'なし') + ' → ' + (b || 'なし')]);
    });
    const html = rows.map((x) => `<li><span class="tag ${x[3] === 'OK' ? 'b' : 'r'}">${x[0]}</span>${esc(String(x[3]))}
      <span class="why">前: ${esc(x[1].slice(0, 70))}</span><span class="why">後: ${esc(String(x[2]).slice(0, 70))}</span></li>`).join('');
    $('verifyOut').innerHTML = `<div class="verdict ${ng ? 'stop' : 'go'}">${ng ? ng + '本で数字が動きました。ここは必ず自分で見てください。' : '数字は全部そのままでした。次はあなたが意味を読んでください。'}</div><ul class="list">${html}</ul>`;
  };
})();
