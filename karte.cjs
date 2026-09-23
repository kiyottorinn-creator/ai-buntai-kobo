#!/usr/bin/env node
/* 文体カルテを、過去記事のフォルダから作る。
   使い方:
     node karte.cjs ./posts                 → buntai_karte.json を作る
     node karte.cjs ./posts --out my.json   → 出し先を変える
     node karte.cjs --karte my.json --draft draft.txt   → 下書きを照合して指示文を出す
   .md .txt .markdown を読む。見出し・コードブロック・画像・リンク記法は落とす。
*/
const fs = require('fs'), path = require('path');
const E = require(path.join(__dirname, 'page/engine.js'));
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };

function clean(md) {
  return md
    .replace(/```[\s\S]*?```/g, '')            // コードブロック
    .replace(/^---[\s\S]*?^---/m, '')          // 先頭の設定ブロック
    .replace(/^#{1,6}\s.*$/gm, '')             // 見出し
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')      // 画像
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // リンク
    .replace(/^\s*[-*+>]\s?/gm, '')            // 箇条書き・引用
    .replace(/[*_`~]/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

if (a.includes('--draft')) {
  const karte = JSON.parse(fs.readFileSync(opt('--karte', 'buntai_karte.json'), 'utf8'));
  const draft = clean(fs.readFileSync(opt('--draft'), 'utf8'));
  const r = E.checkDraft(karte, draft);
  const n = r.rows.filter((x) => x.flags.length).length;
  console.error(`全${r.rows.length}文のうち ${n}文（${Math.round(n / r.rows.length * 100)}%）に色が付きました。赤${r.counts.red} 黄${r.counts.yellow} 青${r.counts.blue}`);
  process.stdout.write(E.buildPrompt(karte, r));
  process.exit(0);
}

const dir = a.find((x) => !x.startsWith('--'));
if (!dir) { console.error('使い方: node karte.cjs ./過去記事のフォルダ'); process.exit(2); }
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(md|txt|markdown)$/i.test(f)) files.push(p);
  }
})(dir);
const texts = files.map((f) => clean(fs.readFileSync(f, 'utf8'))).filter((t) => t.length > 300);
if (texts.length < 2) { console.error(`使える記事が${texts.length}本しかありません（300字以上のファイルが2本以上必要です）`); process.exit(1); }
const karte = E.makeKarte(texts);
if (karte.error) { console.error(karte.error); process.exit(1); }
karte.source_files = files.length;
const out = opt('--out', 'buntai_karte.json');
fs.writeFileSync(out, JSON.stringify(karte, null, 2));
console.log(`${texts.length}本 / ${karte.chars}字 / ${karte.sentences}文 から作りました → ${out}`);
console.log(`一文の真ん中 ${karte.sentence_len.median}字（上位1割 ${karte.sentence_len.p90}字）／漢字 ${Math.round(karte.kanji_ratio * 100)}%／読点 ${karte.comma_per_sentence}個`);
console.log(`よく使う文末: ${karte.enders.slice(0, 6).map((e) => e.key + ' ' + e.n).join(' / ')}`);
