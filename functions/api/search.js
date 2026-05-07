// 銘柄検索（Yahoo Finance v1 search）
// /api/search?q=トヨタ

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get("q");
  if (!q) return json({ error: "q required" }, 400);

  const target = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&lang=ja-JP&region=JP&quotesCount=15&newsCount=0`;
  const res = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; koukasya-kabu/1.0)",
      "Accept": "application/json",
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
  const data = await res.json();
  const items = (data.quotes || [])
    .filter(it => it.symbol && (it.exchange === "JPX" || it.symbol.endsWith(".T") || it.exchDisp === "Tokyo"))
    .map(it => ({
      symbol: it.symbol,
      shortname: it.shortname || it.longname || it.symbol,
      longname: it.longname || it.shortname,
      exch: it.exchDisp,
      type: it.quoteType,
    }));

  return json({ items }, 200, 300);
}

function json(obj, status = 200, swr = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": swr ? `public, max-age=${swr}, stale-while-revalidate=600` : "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
