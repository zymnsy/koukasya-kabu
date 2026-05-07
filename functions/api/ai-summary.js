// 銘柄AI要約（Gemini API）
// /api/ai-summary?symbol=7203.T (POST body: {context: "..."})
// 環境変数 GEMINI_API_KEY が必要

export const onRequestOptions = () => new Response(null, {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  },
});

export async function onRequestPost(context) {
  return handle(context);
}

export async function onRequest(context) {
  return handle(context);
}

async function handle(context) {
  const url = new URL(context.request.url);
  const apiKey = context.env?.GEMINI_API_KEY;
  if (!apiKey) return json({ error: "GEMINI_API_KEY not set", text: "AI要約にはサーバ側のGEMINI_API_KEY設定が必要です（Cloudflare Pages > Settings > Environment variables）" }, 200);

  let body = {};
  try { body = await context.request.json(); } catch {}
  const ctx = body.context || "";
  const symbol = body.symbol || url.searchParams.get("symbol") || "";
  if (!ctx) return json({ error: "context required" }, 400);

  const prompt = `あなたは日本株の有能なアナリストです。以下の銘柄データを200-300字の日本語で簡潔に要約してください。
- 業績の方向性（伸びている/横ばい/縮小）
- 割安/割高の総合判定（PER, PBR, 配当利回り, ROE, F-Scoreから）
- 注目ポイントを2-3点
- リスクや注意点を1-2点
誇張や投資推奨はせず、データに即した中立的な要約に徹してください。

[銘柄] ${symbol}
[データ]
${ctx}
`;

  const target = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  try {
    const r = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: `gemini ${r.status}`, text: t.slice(0, 200) }, 200);
    }
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text || "(要約取得失敗)";
    return json({ text }, 200);
  } catch (e) {
    return json({ error: String(e), text: "要約生成中にエラーが発生しました" }, 200);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
