// チャートデータ取得（Yahoo Finance v8）
// /api/chart?symbol=7203.T&interval=1d&range=1y

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol");
  const interval = url.searchParams.get("interval") || "1d";
  const range = url.searchParams.get("range") || "1y";
  if (!symbol) return json({ error: "symbol required" }, 400);

  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const res = await fetch(target, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; koukasya-kabu/1.0)",
      "Accept": "application/json",
    },
    cf: { cacheTtl: 60, cacheEverything: true },
  });

  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
  const raw = await res.json();

  const r = raw?.chart?.result?.[0];
  if (!r) return json({ error: "no data" }, 404);
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const candles = ts.map((t, i) => ({
    t,
    o: q.open?.[i] ?? null,
    h: q.high?.[i] ?? null,
    l: q.low?.[i] ?? null,
    c: q.close?.[i] ?? null,
    v: q.volume?.[i] ?? null,
  })).filter(c => c.c !== null);

  return json({ meta: r.meta, candles }, 200, 60);
}

function json(obj, status = 200, swr = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": swr ? `public, max-age=${swr}, stale-while-revalidate=120` : "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
