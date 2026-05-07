// 銘柄サマリ（quoteSummary）crumb認証版・高精度モジュール盛
// /api/summary?symbol=7203.T

import { getYahooSession, YAHOO_UA } from "../_lib/yahoo.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol");
  if (!symbol) return json({ error: "symbol required" }, 400);

  const session = await getYahooSession();
  if (!session) return json({}, 200, 60);

  const modules = [
    "price",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
    "earnings",
    "earningsHistory",
    "earningsTrend",
    "incomeStatementHistory",
    "incomeStatementHistoryQuarterly",
    "balanceSheetHistory",
    "balanceSheetHistoryQuarterly",
    "cashflowStatementHistory",
    "cashflowStatementHistoryQuarterly",
    "calendarEvents",
    "recommendationTrend",
    "upgradeDowngradeHistory",
    "majorHoldersBreakdown",
    "assetProfile",
  ].join(",");

  const target = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&lang=ja-JP&region=JP&crumb=${encodeURIComponent(session.crumb)}`;
  const res = await fetch(target, {
    headers: {
      "User-Agent": YAHOO_UA,
      "Accept": "application/json",
      "Cookie": session.cookie,
    },
  });
  if (!res.ok) return json({}, 200, 60);
  const data = await res.json();
  return json(data?.quoteSummary?.result?.[0] || {}, 200, 300);
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
