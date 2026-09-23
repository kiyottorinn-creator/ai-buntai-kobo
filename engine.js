/* 文体工房エンジン（外部通信なし・ブラウザとNodeの両方で同じ結果を出す）
   1) makeKarte(texts)  : 自分の過去記事から文体カルテを作る
   2) checkDraft(karte, text): AI下書きをカルテと照合して色分けの材料を返す
   3) buildPrompt(...)  : 直しの指示文を組み立てる
*/
(function (root) {
  'use strict';

  // ---- 文に切る ------------------------------------------------------------
  function splitSentences(text) {
    const out = [];
    const paras = String(text).replace(/\r/g, '').split(/\n\s*\n|\n/);
    paras.forEach((p, pi) => {
      const t = p.trim();
      if (!t) return;
      const parts = t.match(/[^。！？!?]*[。！？!?]|[^。！？!?]+$/g) || [];
      parts.forEach((s) => {
        const v = s.trim();
        if (v) out.push({ text: v, para: pi });
      });
    });
    return out;
  }

  const RE_KANJI = /[一-鿿々]/g;
  const RE_HIRA = /[ぁ-ゖー]/g;
  const RE_KATA = /[ァ-ヺ]/g;

  function ratio(s, re) {
    const m = s.match(re);
    return s.length ? (m ? m.length : 0) / s.length : 0;
  }

  // ---- 文末の形 ------------------------------------------------------------
  // 「である。」→ ender="である" / class="常体"
  const ENDER_RULES = [
    [/ましょう[。！？!?]?$/, 'ましょう', '勧誘'],
    [/ください[。！？!?]?$/, 'ください', '勧誘'],
    [/ないでしょうか[。！？!?]?$/, 'ないでしょうか', 'ぼかし'],
    [/でしょうか[。！？!?]?$/, 'でしょうか', 'ぼかし'],
    [/でしょう[。！？!?]?$/, 'でしょう', 'ぼかし'],
    [/かもしれません[。！？!?]?$/, 'かもしれません', 'ぼかし'],
    [/(?:らしい|ようだ|みたいだ)[。！？!?]?$/, 'らしい・ようだ', 'ぼかし'],
    [/(?:であろう|だろう)[。！？!?]?$/, 'だろう', 'ぼかし'],
    [/ません[。！？!?]?$/, 'ません', '敬体'],
    [/ました[。！？!?]?$/, 'ました', '敬体'],
    [/ますね[。！？!?]?$/, 'ますね', '敬体'],
    [/ます[。！？!?]?$/, 'ます', '敬体'],
    [/でした[。！？!?]?$/, 'でした', '敬体'],
    [/ですね[。！？!?]?$/, 'ですね', '敬体'],
    [/です[。！？!?]?$/, 'です', '敬体'],
    [/である[。！？!?]?$/, 'である', '常体'],
    [/のだ[。！？!?]?$/, 'のだ', '常体'],
    [/だった[。！？!?]?$/, 'だった', '常体'],
    [/[^たっだ]だ[。！？!?]?$/, 'だ', '常体'],
    [/ない[。！？!?]?$/, 'ない', '常体'],
    [/た[。！？!?]?$/, 'た', '常体'],
    [/る[。！？!?]?$/, 'る', '常体'],
    [/う[。！？!?]?$/, 'う', '常体'],
    [/[^ぁ-ん]い[。！？!?]?$/, '形容詞い', '常体'],
    [/(?:しい|たい|さい|なり|けり|ず|ぬ)[。！？!?]?$/, 'その他の常体', '常体'],
    [/[？?]$/, '？', '問いかけ'],
    [/[！!]$/, '！', '言い切り'],
  ];

  function enderOf(sentence) {
    const s = sentence.trim();
    for (const [re, name, klass] of ENDER_RULES) {
      if (re.test(s)) return { ender: name, klass: klass };
    }
    if (/[」』）\)]$/.test(s)) return { ender: '会話・引用', klass: '会話・引用' };
    const core = s.replace(/[。！？!?、]$/, '');
    const last = core.slice(-1);
    if (/[\u4E00-\u9FFF\u30A1-\u30FA\uFF10-\uFF19A-Za-z0-9]/.test(last)) return { ender: '体言止め', klass: '体言止め' };
    if (/[\u3041-\u3096]/.test(last)) return { ender: '…' + last, klass: '常体' };
    return { ender: 'その他', klass: 'その他' };
  }

  // ---- 文頭の接続 ----------------------------------------------------------
  const HEADS = ['しかし', 'だから', 'つまり', 'そして', 'また', 'さらに', 'ただ', 'ただし',
    'でも', 'それでも', 'そのため', 'したがって', 'なぜなら', 'ちなみに', 'まず', '次に',
    'そこで', 'ところが', 'もちろん', 'たしかに', '確かに', '実は', 'ですから', 'とはいえ',
    '一方', '結論', '最後に', 'では', 'さて', 'つづいて', '続いて', 'この', 'その'];

  function headOf(sentence) {
    const s = sentence.trim();
    for (const h of HEADS) if (s.indexOf(h) === 0) return h;
    return null;
  }

  // ---- n-gram --------------------------------------------------------------
  function ngrams(text, n) {
    const s = String(text).replace(/[\s\n]/g, '');
    const out = [];
    for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
    return out;
  }

  // ひらがなだけの連なりからn字のかたまりを取り出す（話題の言葉ではなく、つなぎ方と語尾を見るため）
  function kanaGrams(text, n) {
    const runs = String(text).match(/[\u3041-\u3096ー]{3,}/g) || [];
    const out = [];
    runs.forEach((r) => { for (let i = 0; i + n <= r.length; i++) out.push(r.slice(i, i + n)); });
    return out;
  }

  function countMap(arr) {
    const m = Object.create(null);
    for (const a of arr) m[a] = (m[a] || 0) + 1;
    return m;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // ---- 1) 文体カルテ -------------------------------------------------------
  function makeKarte(texts, opt) {
    opt = opt || {};
    const all = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
    const joined = all.join('\n\n');
    const sents = splitSentences(joined);
    if (sents.length < 20) {
      return { error: '文が20に届きません。過去記事をもう少し足してください。', sentences: sents.length };
    }

    const lens = sents.map((s) => s.text.length).sort((a, b) => a - b);
    const enders = {}, klasses = {}, heads = {};
    let commas = 0;
    sents.forEach((s) => {
      const e = enderOf(s.text);
      enders[e.ender] = (enders[e.ender] || 0) + 1;
      klasses[e.klass] = (klasses[e.klass] || 0) + 1;
      const h = headOf(s.text);
      if (h) heads[h] = (heads[h] || 0) + 1;
      commas += (s.text.match(/、/g) || []).length;
    });

    // 段落あたりの文数
    const byPara = {};
    sents.forEach((s) => { byPara[s.para] = (byPara[s.para] || 0) + 1; });
    const paraCounts = Object.values(byPara).sort((a, b) => a - b);

    const chars = joined.replace(/[\s\n]/g, '').length;

    // 自分の言い回しの見本帳（ひらがな3字）
    const gram3 = Array.from(new Set(kanaGrams(joined, 3)));

    // 交差検証: 1本を隠して残りで測ると、自分の文でも何割が「見たことがない」になるか
    let unseen = null;
    if (all.length >= 2) {
      const rates = [];
      all.forEach((_, i) => {
        const rest = new Set(kanaGrams(all.filter((__, j) => j !== i).join('\n\n'), 3));
        splitSentences(all[i]).forEach((s2) => {
          const gs = kanaGrams(s2.text, 3);
          if (gs.length < 3) return;
          let miss = 0;
          gs.forEach((g) => { if (!rest.has(g)) miss++; });
          rates.push(miss / gs.length);
        });
      });
      rates.sort((a, b) => a - b);
      if (rates.length >= 20) {
        unseen = {
          n: rates.length,
          median: +quantile(rates, 0.5).toFixed(3),
          p75: +quantile(rates, 0.75).toFixed(3),
          p90: +quantile(rates, 0.9).toFixed(3),
          method: '過去記事を1本ずつ隠し、残りの記事に無いひらがな3字のかたまりが、その文の何割かを数えた',
        };
      }
    }

    return {
      version: 2,
      built_at: opt.now || new Date().toISOString().slice(0, 10),
      source_count: all.length,
      chars: chars,
      sentences: sents.length,
      sentence_len: {
        median: Math.round(quantile(lens, 0.5)),
        mean: Math.round(lens.reduce((a, b) => a + b, 0) / lens.length),
        p25: Math.round(quantile(lens, 0.25)),
        p75: Math.round(quantile(lens, 0.75)),
        p90: Math.round(quantile(lens, 0.9)),
        p95: Math.round(quantile(lens, 0.95)),
        max: lens[lens.length - 1],
      },
      kanji_ratio: +ratio(joined.replace(/[\s\n]/g, ''), RE_KANJI).toFixed(4),
      hira_ratio: +ratio(joined.replace(/[\s\n]/g, ''), RE_HIRA).toFixed(4),
      kata_ratio: +ratio(joined.replace(/[\s\n]/g, ''), RE_KATA).toFixed(4),
      comma_per_sentence: +(commas / sents.length).toFixed(2),
      para_sentences: {
        median: Math.round(quantile(paraCounts, 0.5)),
        p90: Math.round(quantile(paraCounts, 0.9)),
      },
      examples: (function () {
        const med = quantile(lens, 0.5);
        const cand = sents.filter((x) => Math.abs(x.text.length - med) <= med * 0.35 && x.text.length >= 12);
        const step = Math.max(1, Math.floor(cand.length / 10));
        const picked = [];
        for (let i = 0; i < cand.length && picked.length < 10; i += step) picked.push(cand[i].text);
        return picked;
      })(),
      enders: topN(enders, 12),
      ender_class: klasses,
      ender_seen: Object.keys(enders),
      heads: topN(heads, 12),
      unseen: unseen,
      _gram3: gram3, // 照合用の見本帳（表示はしない）
    };
  }

  function topN(map, n) {
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([k, v]) => ({ key: k, n: v }));
  }

  // ---- カルテ同士の距離（0に近いほど似ている） -----------------------------
  function karteDistance(a, b) {
    const parts = [];
    const nz = (x) => (x || 0.000001);
    parts.push(Math.abs(a.sentence_len.median - b.sentence_len.median) / nz(Math.max(a.sentence_len.median, b.sentence_len.median)));
    parts.push(Math.abs(a.kanji_ratio - b.kanji_ratio) / nz(Math.max(a.kanji_ratio, b.kanji_ratio)));
    parts.push(Math.abs(a.comma_per_sentence - b.comma_per_sentence) / nz(Math.max(a.comma_per_sentence, b.comma_per_sentence)));
    // 文末の形の分布差（総変動距離）
    const dist = (k) => {
      const m = {}; let t = 0;
      (k.enders || []).forEach((e) => { m[e.key] = e.n; t += e.n; });
      Object.keys(m).forEach((x) => { m[x] = m[x] / (t || 1); });
      return m;
    };
    const da = dist(a), db = dist(b);
    const keys = new Set([...Object.keys(da), ...Object.keys(db)]);
    let tv = 0;
    keys.forEach((k) => { tv += Math.abs((da[k] || 0) - (db[k] || 0)); });
    parts.push(tv / 2);
    return +(parts.reduce((x, y) => x + y, 0) / parts.length).toFixed(4);
  }

  // ---- 2) 下書きの照合 -----------------------------------------------------
  // AI偏重の言い回し（kit/results/phrase_gap.json の実測から採用したものを既定で入れる）
  const DEFAULT_AI_PHRASES = [];

  function checkDraft(karte, text, opt) {
    opt = opt || {};
    const aiPhrases = opt.aiPhrases || root.BUNTAI_AI_PHRASES || DEFAULT_AI_PHRASES;
    const sents = splitSentences(text);
    const longLimit = (karte.sentence_len && karte.sentence_len.p90) || 60;
    const seen = new Set(karte.ender_seen || []);
    const rare = new Set((karte.enders || []).filter((e) => e.n / Math.max(1, karte.sentences) < 0.01).map((e) => e.key));

    const rows = sents.map((s, i) => {
      const flags = [];
      const e = enderOf(s.text);
      if (!seen.has(e.ender) || rare.has(e.ender)) flags.push({ type: 'red', why: '自分の過去記事にほぼ出てこない文末「' + e.ender + '」' });
      if (s.text.length > longLimit) flags.push({ type: 'yellow', why: '一文' + s.text.length + '字。自分の上位1割は' + longLimit + '字' });
      const hit = aiPhrases.filter((p) => s.text.indexOf(p) >= 0);
      if (hit.length) flags.push({ type: 'yellow', why: 'AIに多く人に少ない言い回し: ' + hit.join('・') });
      if (karte.unseen && karte._gram3) {
        const gs = kanaGrams(s.text, 3);
        if (gs.length >= 3) {
          const seenGrams = karte.__set || (karte.__set = new Set(karte._gram3));
          let miss = 0;
          gs.forEach((g) => { if (!seenGrams.has(g)) miss++; });
          const rate = miss / gs.length;
          if (rate > karte.unseen.p90) {
            flags.push({ type: 'red', why: 'つなぎ方の' + Math.round(rate * 100) + '%が自分の過去記事に無い形。自分の文でも上位1割は' + Math.round(karte.unseen.p90 * 100) + '%' });
          }
        }
      }
      const kr = ratio(s.text.replace(/[\s\n]/g, ''), RE_KANJI);
      if (kr > karte.kanji_ratio + 0.12) flags.push({ type: 'blue', why: '漢字' + Math.round(kr * 100) + '%。自分は' + Math.round(karte.kanji_ratio * 100) + '%' });
      return { i: i, text: s.text, para: s.para, ender: e.ender, len: s.text.length, flags: flags };
    });

    const counts = { red: 0, yellow: 0, blue: 0 };
    rows.forEach((r) => r.flags.forEach((f) => { counts[f.type]++; }));
    const chars = String(text).replace(/[\s\n]/g, '').length;
    const draftKarte = makeKarte([text]);
    return {
      rows: rows,
      counts: counts,
      chars: chars,
      per1000: {
        red: +(counts.red / (chars / 1000)).toFixed(2),
        yellow: +(counts.yellow / (chars / 1000)).toFixed(2),
        blue: +(counts.blue / (chars / 1000)).toFixed(2),
      },
      distance: draftKarte.error ? null : karteDistance(karte, draftKarte),
      draft_karte: draftKarte.error ? null : draftKarte,
    };
  }

  // ---- 3) 直しの指示文 -----------------------------------------------------
  function buildPrompt(karte, result, opt) {
    opt = opt || {};
    const targets = result.rows.filter((r) => r.flags.length);
    const list = targets.map((r, n) => (n + 1) + '. ' + r.text + '\n   （直す理由: ' + r.flags.map((f) => f.why).join(' / ') + '）').join('\n');
    const enders = (karte.enders || []).slice(0, 8).map((e) => e.key).join('・');
    const heads = (karte.heads || []).slice(0, 6).map((h) => h.key).join('・');
    return [
      'あなたは、私の文章の書き直しを手伝う担当です。',
      '',
      '【私の書き方（過去記事' + karte.source_count + '本・' + karte.chars + '字から機械が数えたもの）】',
      '- 一文の長さ: 真ん中が' + karte.sentence_len.median + '字、上位1割で' + karte.sentence_len.p90 + '字。' + karte.sentence_len.p90 + '字を超えたら切る',
      '- よく使う文末: ' + enders,
      '- よく使う書き出し: ' + (heads || '（特定の書き出しに偏りなし）'),
      '- 漢字の割合: ' + Math.round(karte.kanji_ratio * 100) + '%（増やさない）',
      '- 一文あたりの読点: ' + karte.comma_per_sentence + '個',
      '',
      '【私の文の実例（過去記事からそのまま抜いたもの。ここに寄せる）】',
      (karte.examples || []).map((x) => '・' + x).join('\n'),
      '',
      '【やること】',
      '下の番号つきの文だけを、上の書き方に寄せて書き直してください。',
      '',
      '【守ること】',
      '1. 数字・固有名詞・日付・金額は1文字も変えない。増やさない。',
      '2. 事実を足さない。元の文にない体験・実績・効果を書かない。',
      '3. 断定の強さを変えない。「〜と思います」を「〜です」にしない。逆もしない。',
      '4. 私の口ぐせを無理に足さない。ない方が自然なら足さない。',
      '5. 消したほうが自然な文は、本文の代わりに（削除）とだけ返す。',
      '6. 番号と同じ数だけ、番号つきで返す。説明・前置き・まとめは書かない。',
      '',
      '【書き直す文】',
      list,
    ].join('\n');
  }

  const API = { splitSentences, kanaGrams, enderOf, headOf, makeKarte, karteDistance, checkDraft, buildPrompt, ngrams, countMap, quantile, ratio, RE_KANJI };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.BuntaiKobo = API;
})(typeof window !== 'undefined' ? window : globalThis);
