// Yahoo Finance crumb認証ヘルパー
// fc.yahoo.com → Set-Cookie取得 → getcrumb → 以降はcookie+crumb付きでv7/v10を叩ける
// セッションはCache APIで10分キャッシュ

const SESSION_CACHE_URL = "https://internal.koukasya-kabu/yahoo-session";
const SESSION_TTL_SEC = 600;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function getYahooSession() {
  const cache = caches.default;
  const cached = await cache.match(SESSION_CACHE_URL);
  if (cached) {
    const j = await cached.json();
    if (j?.cookie && j?.crumb) return j;
  }

  // 1. cookie取得
  const fcRes = await fetch("https://fc.yahoo.com/", {
    headers: { "User-Agent": UA, "Accept": "text/html" },
    redirect: "manual",
  });
  const setCookie = fcRes.headers.get("set-cookie") || "";
  // A1/A3クッキーを抜き出す
  const cookie = parseSetCookie(setCookie);
  if (!cookie) return null;

  // 2. crumb取得
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, "Accept": "text/plain", "Cookie": cookie },
  });
  if (!crumbRes.ok) return null;
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 50) return null;

  const session = { cookie, crumb };
  // キャッシュ
  await cache.put(
    SESSION_CACHE_URL,
    new Response(JSON.stringify(session), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${SESSION_TTL_SEC}`,
      },
    })
  );
  return session;
}

function parseSetCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  // Workers環境ではset-cookieが連結されてくることがある
  const parts = setCookieHeader.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  const pairs = [];
  for (const p of parts) {
    const m = p.match(/^\s*([A-Za-z0-9_\-]+)=([^;]+)/);
    if (m) pairs.push(`${m[1]}=${m[2]}`);
  }
  return pairs.join("; ") || null;
}

export const YAHOO_UA = UA;
