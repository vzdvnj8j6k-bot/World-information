// /api/search?source=gnews&q=キーワード&lang=ja   … 1つの情報源を検索
// /api/search                                      … 情報源の一覧
// ローカルサーバー(server.js)とVercelのサーバーレス関数の両方で動く
const { searchSource, SOURCES } = require('../lib/sources');

function send(res, status, obj, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cache) res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const source = u.searchParams.get('source');
  if (!source) return send(res, 200, { sources: SOURCES });
  try {
    const data = await searchSource({
      source,
      q: u.searchParams.get('q') || '',
      lang: (u.searchParams.get('lang') || 'ja').slice(0, 8),
    });
    send(res, 200, data, !data.error);
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
};
