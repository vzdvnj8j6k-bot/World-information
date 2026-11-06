// 信頼度ランク(A/B/C)の判定
//
// ニュース・百科事典: 配信元サイトの「アクセス数ランキング」で判定
//   データ: Tranco リスト(https://tranco-list.eu/)の上位10万サイト
//   Chrome UX Report・Cloudflare Radar・Umbrella 等の実アクセス計測を統合した研究用の公開ランキング
//   A = 世界 5,000位以内 / B = 50,000位以内 / C = それ以下・圏外
// 論文: 「被引用数」(どれだけ他の研究者に参照されたか)で判定
//   A = 100回以上 / B = 10回以上 / C = 10回未満・未査読プレプリント
const fs = require('fs');
const path = require('path');

const NEWS_A = 5000;
const NEWS_B = 50000;
const CITE_A = 100;
const CITE_B = 10;

let ranks = null;
function load() {
  if (ranks) return ranks;
  ranks = new Map();
  try {
    const lines = fs.readFileSync(path.join(__dirname, '..', 'data', 'tranco-top100k.txt'), 'utf8').split('\n');
    lines.forEach((d, i) => d && !ranks.has(d) && ranks.set(d.trim(), i + 1));
  } catch (e) {
    console.error('アクセス数ランキングの読み込みに失敗:', e.message);
  }
  return ranks;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\d*\./, ''); } catch { return ''; }
}

// sub.example.co.jp → example.co.jp のように親ドメインもたどって順位を探す
function siteRank(hostOrUrl) {
  const r = load();
  let h = hostOrUrl.includes('/') ? hostOf(hostOrUrl) : hostOrUrl.toLowerCase().replace(/^www\d*\./, '');
  while (h && h.includes('.')) {
    if (r.has(h)) return { rank: r.get(h), domain: h };
    h = h.slice(h.indexOf('.') + 1);
  }
  return null;
}

const fmt = (n) => n.toLocaleString('ja-JP');

function gradeItem(it) {
  if (it.type === 'paper') {
    if (it.preprint) return { grade: 'C', basis: '未査読のプレプリント（査読前の論文）' };
    if (typeof it.citations !== 'number') return { grade: 'C', basis: '被引用数が取得できませんでした' };
    const g = it.citations >= CITE_A ? 'A' : it.citations >= CITE_B ? 'B' : 'C';
    return { grade: g, basis: `被引用数 ${fmt(it.citations)}回` };
  }
  const target = it.domain || it.url;
  const sr = siteRank(target);
  if (!sr) return { grade: 'C', basis: `${hostOf(target) || target}: アクセス数ランキング10万位圏外` };
  const g = sr.rank <= NEWS_A ? 'A' : sr.rank <= NEWS_B ? 'B' : 'C';
  return { grade: g, basis: `${sr.domain}: 世界のアクセス数 ${fmt(sr.rank)}位` };
}

module.exports = { gradeItem, siteRank, hostOf };
