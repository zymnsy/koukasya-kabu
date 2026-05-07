// 銘柄の最新クォート取得
// 1) Yahoo v7 quote（crumb必須）に挑戦、失敗したら chart v8 metaから組み立て
// /api/quote?symbols=7203.T,9984.T

import { getYahooSession, YAHOO_UA } from "../_lib/yahoo.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const symbols = url.searchParams.get("symbols");
  if (!symbols) return json({ error: "symbols required" }, 400);

  const session = await getYahooSession();
  if (session) {
    try {
      const target = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(session.crumb)}`;
      const res = await fetch(target, {
        headers: {
          "User-Agent": YAHOO_UA,
          "Accept": "application/json",
          "Cookie": session.cookie,
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.quoteResponse?.result?.length) return json(data, 200, 15);
      }
    } catch (e) { /* fallthrough */ }
  }

  // Fallback: chart v8 から組み立て（PER/PBR/配当は無いがprice/changeは取れる）
  const list = symbols.split(",").map(s => s.trim()).filter(Boolean);
  const results = await Promise.all(list.map(async (sym) => {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, {
        headers: { "User-Agent": YAHOO_UA, "Accept": "application/json" },
      });
      if (!r.ok) return null;
      const d = await r.json();
      const m = d?.chart?.result?.[0]?.meta;
      if (!m) return null;
      const close = m.regularMarketPrice ?? m.previousClose ?? null;
      const prev = m.chartPreviousClose ?? m.previousClose ?? null;
      const change = (close != null && prev != null) ? close - prev : null;
      const changePct = (change != null && prev) ? (change / prev) * 100 : null;
      return {
        symbol: sym,
        shortName: m.shortName || sym,
        longName: m.longName || m.shortName || sym,
        exchange: m.exchangeName,
        fullExchangeName: m.fullExchangeName,
        currency: m.currency,
        regularMarketPrice: close,
        regularMarketChange: change,
        regularMarketChangePercent: changePct,
        regularMarketOpen: m.regularMarketOpen ?? null,
        regularMarketDayHigh: m.regularMarketDayHigh ?? null,
        regularMarketDayLow: m.regularMarketDayLow ?? null,
        regularMarketVolume: m.regularMarketVolume ?? null,
        fiftyTwoWeekHigh: m.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: m.fiftyTwoWeekLow,
        // 以下はfallbackでは取得不可（フロント側でnull扱い）
        marketCap: null,
        trailingPE: null,
        priceToBook: null,
        trailingAnnualDividendYield: null,
      };
    } catch { return null; }
  }));

  return json({
    quoteResponse: { result: results.filter(Boolean), error: null },
    _fallback: true,
  }, 200, 15);
}

function json(obj, status = 200, swr = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": swr ? `public, max-age=${swr}, stale-while-revalidate=60` : "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
