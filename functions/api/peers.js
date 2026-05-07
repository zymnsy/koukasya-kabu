// 同業他社（peers）取得
// /api/peers?symbol=7203.T

import { getYahooSession, YAHOO_UA } from "../_lib/yahoo.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return json({ error: "symbol required" }, 400);

  const session = await getYahooSession();
  if (!session) return json({ peers: [] }, 200);

  // recommendations-by-symbolはcrumb不要だが念のため付与
  const target = `https://query1.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}?count=6&crumb=${encodeURIComponent(session.crumb)}`;
  const res = await fetch(target, {
    headers: { "User-Agent": YAHOO_UA, "Accept": "application/json", "Cookie": session.cookie },
  });
  if (!res.ok) return json({ peers: [] }, 200);
  const data = await res.json();
  const recs = data?.finance?.result?.[0]?.recommendedSymbols || [];
  const peers = recs.map(r => r.symbol).filter(s => s && s.endsWith(".T"));
  return json({ peers }, 200, 600);
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
