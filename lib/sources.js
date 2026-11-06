// 世界中のニュース・論文・百科事典を集めてくる情報源の定義
// 依存パッケージなし(Node.js 18+ の fetch を使用)

const { gradeItem, hostOf } = require('./rank');
const UA = 'WorldHub/1.0 (news & paper aggregator)';

async function fetchText(url, timeoutMs = 9000, retry = 1) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: ctrl.signal });
    if (res.status === 429 && retry > 0) { await new Promise((r) => setTimeout(r, 1200)); return fetchText(url, timeoutMs, retry - 1); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('タイムアウト');
    if (retry > 0 && /fetch failed/.test(e.message)) return fetchText(url, timeoutMs, retry - 1);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
async function fetchJSON(url, timeoutMs) {
  const txt = await fetchText(url, timeoutMs);
  try { return JSON.parse(txt); } catch { throw new Error('JSONの解析に失敗'); }
}

// ---------- XML(RSS / Atom / RDF)の簡易パーサー ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function stripHtml(s = '') {
  return decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}
function attr(block, name, attrName) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*${attrName}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
}
function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let link = stripHtml(tag(b, 'link'));
    if (!link) link = attr(b, 'link', 'href');
    return {
      title: stripHtml(tag(b, 'title')),
      link,
      summary: stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')),
      date: toISO(stripHtml(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))),
      sourceName: stripHtml(tag(b, 'source')),
      sourceUrl: attr(b, 'source', 'url'),
      image: attr(b, 'media:thumbnail', 'url') || attr(b, 'media:content', 'url') || attr(b, 'enclosure', 'url') ||
        (decode(b).match(/<img[^>]+src="(https?:[^"]+)"/i) || [])[1] || '',
      authors: (b.match(/<author>[\s\S]*?<\/author>/gi) || []).map((a) => stripHtml(tag(a, 'name'))).filter(Boolean),
    };
  });
}
function toISO(s) {
  if (!s) return null;
  // GDELT形式 20261106T090000Z
  const g = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (g) return `${g[1]}-${g[2]}-${g[3]}T${g[4]}:${g[5]}:${g[6]}Z`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}
function clip(s = '', n = 400) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function matches(q, ...texts) {
  if (!q) return true;
  const hay = texts.join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

// ---------- ニュース ----------
const GN_LOCALE = {
  ja: ['ja', 'JP', 'JP:ja'],
  en: ['en-US', 'US', 'US:en'],
  'en-GB': ['en-GB', 'GB', 'GB:en'],
  zh: ['zh-TW', 'TW', 'TW:zh-Hant'],
  ko: ['ko', 'KR', 'KR:ko'],
  fr: ['fr', 'FR', 'FR:fr'],
  de: ['de', 'DE', 'DE:de'],
  es: ['es-419', 'MX', 'MX:es-419'],
  in: ['en-IN', 'IN', 'IN:en'],
};

async function googleNews({ q, lang }) {
  const [hl, gl, ceid] = GN_LOCALE[lang] || GN_LOCALE.ja;
  const base = q
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&`
    : 'https://news.google.com/rss?';
  const xml = await fetchText(`${base}hl=${hl}&gl=${gl}&ceid=${ceid}`);
  return parseFeed(xml).slice(0, 40).map((it) => {
    // タイトル末尾の「 - 媒体名」を分離
    const src = it.sourceName;
    const title = src && it.title.endsWith(` - ${src}`) ? it.title.slice(0, -(src.length + 3)) : it.title;
    return { type: 'news', title, url: it.link, domain: hostOf(it.sourceUrl), summary: '', date: it.date, publisher: src, lang };
  });
}

async function gdelt({ q, qEn }) {
  q = qEn || q;
  if (!q) return [];
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=40&sort=datedesc&timespan=2w`;
  const txt = await fetchText(url, 25000, 0);
  if (!txt.trim().startsWith('{')) throw new Error(clip(txt.trim(), 80) || '結果なし');
  const data = JSON.parse(txt);
  return (data.articles || []).map((a) => ({
    type: 'news',
    title: a.title,
    url: a.url,
    summary: '',
    date: toISO(a.seendate),
    publisher: a.domain,
    domain: a.domain,
    country: a.sourcecountry,
    lang: a.language,
  }));
}

async function hackerNews({ q, qEn }) {
  q = qEn || q;
  const url = q
    ? `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=25`
    : 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=25';
  const data = await fetchJSON(url);
  return (data.hits || []).map((h) => ({
    type: 'news',
    title: h.title,
    url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    summary: '',
    date: h.created_at,
    publisher: 'Hacker News',
    meta: `▲${h.points ?? 0} · 💬${h.num_comments ?? 0}`,
    discuss: `https://news.ycombinator.com/item?id=${h.objectID}`,
    lang: 'en',
  }));
}

// 世界の主要メディアのRSS(検索語がある場合は見出しで絞り込み)
const MEDIA_FEEDS = [
  { name: 'NHK', url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', lang: 'ja', country: '日本' },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', lang: 'en', country: 'イギリス' },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', lang: 'en', country: 'イギリス' },
  { name: 'NYT World', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', lang: 'en', country: 'アメリカ' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', lang: 'en', country: 'カタール' },
  { name: 'DW', url: 'https://rss.dw.com/rdf/rss-en-all', lang: 'en', country: 'ドイツ' },
  { name: 'France 24', url: 'https://www.france24.com/en/rss', lang: 'en', country: 'フランス' },
];

async function worldMedia({ q, qEn }) {
  const results = await Promise.allSettled(
    MEDIA_FEEDS.map(async (f) =>
      parseFeed(await fetchText(f.url, 8000))
        .filter((it) => matches(q, it.title, it.summary) || (qEn && matches(qEn, it.title, it.summary)))
        .slice(0, 15)
        .map((it) => ({
          type: 'news',
          title: it.title,
          url: it.link,
          summary: clip(it.summary, 300),
          date: it.date,
          publisher: f.name,
          country: f.country,
          lang: f.lang,
        }))
    )
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) throw new Error('全フィードの取得に失敗');
  return ok.flatMap((r) => r.value);
}

// ---------- 論文 ----------
function invertedToText(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.join(' ');
}

async function openAlex({ q, qEn }) {
  q = qEn || q;
  const select = 'id,display_name,publication_date,authorships,primary_location,doi,cited_by_count,abstract_inverted_index,open_access,language';
  let url;
  if (q) {
    url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=25&select=${select}`;
  } else {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    url = `https://api.openalex.org/works?filter=from_publication_date:${since},has_abstract:true&sort=cited_by_count:desc&per-page=25&select=${select}`;
  }
  const data = await fetchJSON(url, 12000);
  return (data.results || []).map((w) => ({
    type: 'paper',
    title: stripHtml(w.display_name || ''),
    url: w.doi || w.primary_location?.landing_page_url || w.id,
    pdf: w.open_access?.oa_url || null,
    summary: clip(invertedToText(w.abstract_inverted_index), 600),
    date: w.publication_date ? toISO(w.publication_date) : null,
    authors: (w.authorships || []).slice(0, 6).map((a) => a.author?.display_name).filter(Boolean),
    publisher: w.primary_location?.source?.display_name || 'OpenAlex',
    citations: w.cited_by_count ?? 0,
    lang: w.language,
  }));
}

async function arxiv({ q, qEn }) {
  q = qEn || q;
  const sq = q
    ? q.split(/\s+/).filter(Boolean).map((w) => `all:${w}`).join(' AND ')
    : 'cat:cs.AI OR cat:cs.LG OR cat:astro-ph.GA OR cat:q-bio.NC OR cat:physics.soc-ph';
  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(sq)}&sortBy=${q ? 'relevance' : 'submittedDate'}&sortOrder=descending&max_results=20`;
  const xml = await fetchText(url, 12000);
  return parseFeed(xml)
    .filter((e) => e.title && e.title !== 'Error')
    .map((e) => ({
      type: 'paper',
      title: e.title,
      url: e.link || '',
      pdf: e.link ? e.link.replace('/abs/', '/pdf/') : null,
      summary: clip(e.summary, 600),
      date: e.date,
      authors: e.authors.slice(0, 6),
      publisher: 'arXiv',
      meta: 'プレプリント',
      preprint: true,
      lang: 'en',
    }));
}

async function pubmed({ q, qEn }) {
  q = qEn || q;
  if (!q) return [];
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const s = await fetchJSON(`${base}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(q)}&retmode=json&retmax=20&sort=relevance`);
  const ids = s.esearchresult?.idlist || [];
  if (!ids.length) return [];
  const [sum, cites] = await Promise.all([
    fetchJSON(`${base}/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json`),
    // 被引用数は OpenAlex から PMID で一括取得
    fetchJSON(`https://api.openalex.org/works?filter=pmid:${ids.join('|')}&select=ids,cited_by_count&per-page=50`)
      .then((d) => Object.fromEntries((d.results || []).map((w) => [String(w.ids?.pmid || '').replace(/\D/g, ''), w.cited_by_count])))
      .catch(() => ({})),
  ]);
  return ids
    .map((id) => sum.result?.[id])
    .filter(Boolean)
    .map((r) => ({
      type: 'paper',
      title: stripHtml(r.title),
      url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`,
      pdf: null,
      summary: '',
      date: toISO(r.sortpubdate?.replace(/\//g, '-')) || toISO(r.pubdate),
      authors: (r.authors || []).slice(0, 6).map((a) => a.name),
      publisher: r.fulljournalname || r.source || 'PubMed',
      meta: '医学・生命科学',
      citations: cites[r.uid],
      lang: 'en',
    }));
}

// ---------- 雑学・教養 ----------
const md = () => {
  const d = new Date(Date.now() + 9 * 3600e3); // 日本時間の日付
  return { y: d.getUTCFullYear(), m: String(d.getUTCMonth() + 1).padStart(2, '0'), d: String(d.getUTCDate()).padStart(2, '0') };
};
const wikiUrl = (lang, title) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;

async function wikiToday({ q, qEn }) {
  const { y, m, d } = md();
  const H = { headers: { 'User-Agent': UA } };
  const [feat, otd, ...randoms] = await Promise.allSettled([
    fetchJSON(`https://ja.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`),
    fetchJSON(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/${m}/${d}`),
    ...(q ? [] : Array.from({ length: 6 }, () => fetchJSON('https://ja.wikipedia.org/api/rest_v1/page/random/summary'))),
  ]);
  const out = [];
  const tfa = feat.value?.tfa;
  if (tfa && matches(q, tfa.title, tfa.extract))
    out.push({
      type: 'trivia', title: tfa.titles?.normalized || tfa.title, url: tfa.content_urls?.desktop?.page || wikiUrl('ja', tfa.title),
      summary: clip(tfa.extract, 400), image: tfa.thumbnail?.source, date: null,
      publisher: 'Wikipedia', meta: '📌 今日の秀逸な記事', lang: 'ja',
    });
  for (const e of otd.value?.selected || []) {
    const p = e.pages?.[0];
    if (!matches(q, e.text) && !(qEn && matches(qEn, e.text))) continue;
    out.push({
      type: 'trivia', title: `${e.year}年の今日: ${e.text}`, url: p?.content_urls?.desktop?.page || wikiUrl('en', p?.title || ''),
      summary: clip(p?.extract || '', 300), image: p?.thumbnail?.source, date: null,
      publisher: 'Wikipedia', meta: `📅 今日は何の日（${+m}月${+d}日）`, lang: 'en',
    });
  }
  for (const r of randoms) {
    const p = r.value;
    if (!p?.extract || p.extract.length < 60) continue;
    out.push({
      type: 'trivia', title: p.titles?.normalized || p.title, url: p.content_urls?.desktop?.page || wikiUrl('ja', p.title),
      summary: clip(p.extract, 300), image: p.thumbnail?.source, date: null,
      publisher: 'Wikipedia', meta: '🎲 ランダムな記事', lang: 'ja',
    });
  }
  if (!out.length && feat.status === 'rejected' && otd.status === 'rejected') throw new Error('取得に失敗');
  return out;
}

function feedGroup(feeds, perFeed = 12) {
  return async ({ q, qEn }) => {
    const results = await Promise.allSettled(
      feeds.map(async (f) =>
        parseFeed(await fetchText(f.url, 9000))
          .filter((it) => matches(q, it.title, it.summary) || (qEn && matches(qEn, it.title, it.summary)))
          .slice(0, perFeed)
          .map((it) => ({
            type: 'trivia', title: it.title, url: it.link, summary: clip(it.summary, 300), image: it.image || null,
            date: it.date, publisher: f.name, country: f.country, lang: f.lang,
          }))
      )
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    if (!ok.length) throw new Error('全フィードの取得に失敗');
    return ok.flatMap((r) => r.value);
  };
}

const JP_TRIVIA = [
  { name: 'ナゾロジー', url: 'https://nazology.kusuguru.co.jp/feed', lang: 'ja', country: '日本' },
  { name: 'カラパイア', url: 'https://karapaia.com/index.rdf', lang: 'ja', country: '日本' },
  { name: 'GIGAZINE', url: 'https://gigazine.net/news/rss_2.0/', lang: 'ja', country: '日本' },
];
const WORLD_CULTURE = [
  { name: 'The Conversation', url: 'https://theconversation.com/global/articles.atom', lang: 'en', country: '研究者が執筆' },
  { name: 'Smithsonian', url: 'https://www.smithsonianmag.com/rss/latest_articles/', lang: 'en', country: 'アメリカ' },
  { name: 'Aeon', url: 'https://aeon.co/feed.rss', lang: 'en', country: 'イギリス' },
  { name: 'Atlas Obscura', url: 'https://www.atlasobscura.com/feeds/latest', lang: 'en', country: 'アメリカ' },
];

// ---------- 百科事典 ----------
function wikipedia(lang) {
  return async ({ q, qEn }) => {
    if (lang === 'en' && qEn) q = qEn;
    if (!q) return [];
    const data = await fetchJSON(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=8&utf8=1`
    );
    return (data.query?.search || []).map((p) => ({
      type: 'wiki',
      title: p.title,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      summary: stripHtml(p.snippet) + '…',
      date: p.timestamp,
      publisher: `Wikipedia (${lang})`,
      meta: `${Math.round((p.wordcount || 0) / 100) / 10}k語`,
      lang,
    }));
  };
}

// ---------- 情報源一覧 ----------
const SOURCES = [
  { id: 'gnews', name: 'Google ニュース', type: 'news', fn: googleNews },
  { id: 'media', name: '世界の主要メディア', type: 'news', fn: worldMedia },
  { id: 'gdelt', name: 'GDELT (世界100か国超)', type: 'news', fn: gdelt },
  { id: 'hn', name: 'Hacker News', type: 'news', fn: hackerNews },
  { id: 'openalex', name: 'OpenAlex (2億件超の論文)', type: 'paper', fn: openAlex },
  { id: 'arxiv', name: 'arXiv', type: 'paper', fn: arxiv },
  { id: 'pubmed', name: 'PubMed', type: 'paper', fn: pubmed },
  { id: 'wikitoday', name: '今日の雑学 (Wikipedia)', type: 'trivia', fn: wikiToday },
  { id: 'jtrivia', name: 'ナゾロジー・カラパイア・GIGAZINE', type: 'trivia', fn: feedGroup(JP_TRIVIA) },
  { id: 'culture', name: '世界の教養メディア', type: 'trivia', fn: feedGroup(WORLD_CULTURE, 10) },
  { id: 'wikija', name: 'Wikipedia 日本語', type: 'wiki', fn: wikipedia('ja') },
  { id: 'wikien', name: 'Wikipedia 英語', type: 'wiki', fn: wikipedia('en') },
];

// ---------- 翻訳(Google翻訳の公開エンドポイント・キー不要) ----------
const trCache = new Map();
async function translate(text, tl = 'en') {
  const key = tl + '|' + text;
  if (trCache.has(key)) return trCache.get(key);
  let out;
  try {
    const data = await fetchJSON(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`,
      6000
    );
    out = (data[0] || []).map((x) => x[0]).join('');
  } catch {
    // 予備: MyMemory 翻訳API(キー不要・1日あたりの上限あり)
    const sl = hasCJK(text) ? (/[぀-ヿ]/.test(text) ? 'ja' : /[가-힯]/.test(text) ? 'ko' : 'zh-CN') : 'en';
    if (sl === tl.slice(0, 2)) return text;
    const d = await fetchJSON(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=${sl}|${tl}`, 8000);
    if (d.responseStatus !== 200) throw new Error('翻訳に失敗');
    out = decode(d.responseData.translatedText || '');
  }
  if (!out) throw new Error('翻訳に失敗');
  trCache.set(key, out);
  if (trCache.size > 3000) trCache.delete(trCache.keys().next().value);
  return out;
}
const hasCJK = (s) => /[぀-ヿ㐀-鿿가-힯]/.test(s);

const cache = new Map();
const TTL = 5 * 60 * 1000;

// 1つの情報源を検索(画面側は全情報源を並列に呼び、届いた順に表示する)
async function searchSource({ source, q = '', lang = 'ja' }) {
  const s = SOURCES.find((x) => x.id === source);
  if (!s) throw new Error('不明な情報源: ' + source);
  q = q.trim().slice(0, 200);
  const key = JSON.stringify([source, q, lang]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };

  let qEn = '';
  if (q && hasCJK(q)) qEn = await translate(q, 'en').catch(() => '');

  const t0 = Date.now();
  let items = [], error;
  try {
    items = (await s.fn({ q, qEn, lang })).filter((it) => it.title && it.url);
    items.forEach((it) => {
      it.sourceId = s.id;
      it.rank = gradeItem(it);
    });
  } catch (e) {
    error = String(e.message || e);
  }
  const data = { id: s.id, name: s.name, type: s.type, q, qEn, count: items.length, ms: Date.now() - t0, error, items };
  if (!error) {
    cache.set(key, { at: Date.now(), data });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
  }
  return data;
}

async function translateMany(texts, tl = 'ja') {
  const out = new Array(texts.length);
  let i = 0;
  const worker = async () => {
    while (i < texts.length) {
      const n = i++;
      const t = texts[n];
      out[n] = !t ? '' : await translate(String(t).slice(0, 1500), tl).catch(() => t);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  return out;
}

module.exports = { searchSource, translateMany, SOURCES: SOURCES.map(({ id, name, type }) => ({ id, name, type })) };
