// 光菓舎-Kabu / メインアプリ
// 1画面ダッシュボード：検索→チャート→KPI→割安スコア→業績→ウォッチ→スクリーナー
// データ：Cloudflare Pages Functions経由でYahoo Finance、15秒ポーリング

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ========== STATE ==========
const state = {
  symbol: null,
  range: "1mo",
  interval: "1d",
  ctype: "candle",
  chart: null,
  series: null,
  refreshTimer: null,
  watchlist: loadWatchlist(),
  popular: null,
  earnings: null,
  earnMetric: "revenue",
};

// ========== INIT ==========
init().catch(err => console.error("init error", err));

async function init() {
  // theme
  const theme = localStorage.getItem("kabu_theme") || "dark";
  document.body.dataset.theme = theme;
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = cur;
    localStorage.setItem("kabu_theme", cur);
    if (state.chart) recreateChart();
  });

  // popular
  state.popular = await fetch("./data/popular.json").then(r => r.json());
  renderPopular();
  renderWatchlist();

  // search
  setupSearch();

  // range tabs
  $$(".range-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.range = btn.dataset.range;
    state.interval = btn.dataset.interval;
    if (state.symbol) loadChart();
  }));

  // chart type tabs
  $$(".ctype-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".ctype-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.ctype = btn.dataset.ctype;
    if (state.symbol) recreateChart();
  }));

  // earnings tabs
  $$(".earn-tab").forEach(btn => btn.addEventListener("click", () => {
    $$(".earn-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.earnMetric = btn.dataset.metric;
    renderEarnings();
  }));

  // refresh now
  $("#refresh-now").addEventListener("click", () => {
    if (state.symbol) loadAll();
  });

  // add to watch
  $("#watch-add").addEventListener("click", () => {
    if (!state.symbol) return;
    addToWatchlist(state.symbol, $("#t-name").textContent);
  });

  // screener
  $("#sc-run").addEventListener("click", runScreener);

  // initial: load Toyota or last viewed
  const last = localStorage.getItem("kabu_last_symbol") || "7203.T";
  selectSymbol(last);

  // resize
  window.addEventListener("resize", () => {
    if (state.chart) {
      const el = $("#chart");
      state.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    }
  });

  // visibility (止める)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoRefresh();
    else if (state.symbol) startAutoRefresh();
  });
}

// ========== SEARCH ==========
let searchTimer = null;
function setupSearch() {
  const input = $("#search");
  const list = $("#suggest");
  let activeIdx = -1;
  let items = [];

  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) { list.classList.add("hidden"); return; }
    searchTimer = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => ({ items: [] }));
      items = r.items || [];
      // 数字のみなら .T 直接候補も追加
      if (/^\d{4}$/.test(q) && !items.some(i => i.symbol === `${q}.T`)) {
        items.unshift({ symbol: `${q}.T`, shortname: `銘柄コード ${q}`, exch: "Tokyo" });
      }
      activeIdx = -1;
      renderSuggest(items);
    }, 200);
  });

  input.addEventListener("keydown", (e) => {
    if (list.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length-1, activeIdx+1); highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx-1); highlight(); }
    else if (e.key === "Enter") { e.preventDefault();
      const pick = items[activeIdx >= 0 ? activeIdx : 0];
      if (pick) { selectSymbol(pick.symbol); input.value = ""; list.classList.add("hidden"); }
    }
    else if (e.key === "Escape") list.classList.add("hidden");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) list.classList.add("hidden");
  });

  function renderSuggest(items) {
    if (!items.length) { list.classList.add("hidden"); return; }
    list.innerHTML = items.map((it, i) => `
      <li data-idx="${i}" data-symbol="${it.symbol}">
        <span><span class="sym">${it.symbol}</span> ${it.shortname || ""}</span>
        <span class="ex">${it.exch || ""}</span>
      </li>`).join("");
    list.classList.remove("hidden");
    list.querySelectorAll("li").forEach(li => li.addEventListener("click", () => {
      selectSymbol(li.dataset.symbol);
      input.value = ""; list.classList.add("hidden");
    }));
  }
  function highlight() {
    list.querySelectorAll("li").forEach((li, i) => li.classList.toggle("active", i === activeIdx));
  }
}

// ========== SELECT SYMBOL ==========
function selectSymbol(symbol) {
  state.symbol = symbol;
  localStorage.setItem("kabu_last_symbol", symbol);
  loadAll();
  startAutoRefresh();
}

async function loadAll() {
  await Promise.all([loadQuote(), loadChart(), loadSummary()]);
  $("#updated-at").textContent = new Date().toLocaleTimeString("ja-JP", { hour12: false });
}

function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimer = setInterval(() => { if (!document.hidden) loadQuote(); }, 15_000);
}
function stopAutoRefresh() {
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
}

// ========== QUOTE ==========
async function loadQuote() {
  if (!state.symbol) return;
  try {
    const r = await fetch(`/api/quote?symbols=${encodeURIComponent(state.symbol)}`).then(r => r.json());
    const q = r?.quoteResponse?.result?.[0];
    if (!q) return;
    renderQuote(q);
    renderValuation(q);
    refreshWatchlistRow(state.symbol, q);
  } catch (e) { console.error("loadQuote", e); }
}

function renderQuote(q) {
  $("#t-symbol").textContent = q.symbol;
  $("#t-name").textContent = q.longName || q.shortName || q.symbol;
  $("#t-exch").textContent = q.fullExchangeName || q.exchange || "";
  $("#market-tag").textContent = q.exchange || "JPX";

  const price = q.regularMarketPrice ?? q.postMarketPrice ?? null;
  const chg = q.regularMarketChange ?? 0;
  const chgPct = q.regularMarketChangePercent ?? 0;
  $("#t-price").textContent = fmt(price, 2);
  $("#t-change").textContent = (chg >= 0 ? "+" : "") + fmt(chg, 2);
  $("#t-changepct").textContent = `(${chg >= 0 ? "+" : ""}${fmt(chgPct, 2)}%)`;
  const cls = chg >= 0 ? "up" : "dn";
  $("#t-change").className = `change ${cls}`;
  $("#t-changepct").className = `change-pct ${cls}`;

  $("#t-open").textContent = fmt(q.regularMarketOpen, 2);
  $("#t-high").textContent = fmt(q.regularMarketDayHigh, 2);
  $("#t-low").textContent = fmt(q.regularMarketDayLow, 2);
  $("#t-volume").textContent = fmtVol(q.regularMarketVolume);
  $("#t-mktcap").textContent = fmtCap(q.marketCap);
  $("#t-per").textContent = fmt(q.trailingPE, 2);
  $("#t-pbr").textContent = fmt(q.priceToBook, 2);
  $("#t-yield").textContent = q.trailingAnnualDividendYield != null ? `${fmt(q.trailingAnnualDividendYield * 100, 2)}%` : (q.dividendYield != null ? `${fmt(q.dividendYield, 2)}%` : "--");
}

// ========== VALUATION ==========
function renderValuation(q) {
  // PER: 低い=割安 / 0-30レンジで反転
  const per = q.trailingPE;
  const perScore = scoreInverted(per, 5, 30);
  setScore("per", perScore, per != null ? `${fmt(per,2)}倍` : "--");

  // PBR: 低い=割安 / 0.3-3レンジで反転
  const pbr = q.priceToBook;
  const pbrScore = scoreInverted(pbr, 0.5, 3);
  setScore("pbr", pbrScore, pbr != null ? `${fmt(pbr,2)}倍` : "--");

  // 配当: 高い=良い / 0-6%
  const yld = q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : (q.dividendYield ?? null);
  const yldScore = scoreLinear(yld, 0, 6);
  setScore("yield", yldScore, yld != null ? `${fmt(yld,2)}%` : "--");

  // ROE はsummaryから後で上書き
  if (state.summaryROE != null) {
    const roeScore = scoreLinear(state.summaryROE, 0, 20);
    setScore("roe", roeScore, `${fmt(state.summaryROE,2)}%`);
  }

  // 総合判定
  const scores = [perScore, pbrScore, yldScore].filter(s => s != null);
  const avg = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : null;
  let verdict = "判定不可";
  if (avg != null) {
    if (avg >= 70) verdict = "🟢 割安寄り：バリュー候補";
    else if (avg >= 50) verdict = "🟡 中立：他指標と組み合わせ要";
    else if (avg >= 30) verdict = "🟠 やや割高：成長性で説明できるか確認";
    else verdict = "🔴 割高水準：成長性or期待先行に注意";
  }
  $("#verdict").textContent = verdict;
}

function scoreInverted(val, lo, hi) {
  if (val == null || isNaN(val) || val <= 0) return null;
  const clamped = Math.max(lo, Math.min(hi, val));
  return Math.round((1 - (clamped - lo) / (hi - lo)) * 100);
}
function scoreLinear(val, lo, hi) {
  if (val == null || isNaN(val)) return null;
  const clamped = Math.max(lo, Math.min(hi, val));
  return Math.round(((clamped - lo) / (hi - lo)) * 100);
}
function setScore(key, score, text) {
  const fill = $(`#score-${key}`);
  const t = $(`#score-${key}-text`);
  if (score == null) { fill.style.width = "0%"; t.textContent = text; return; }
  fill.style.width = `${score}%`;
  t.textContent = `${text}（スコア ${score}）`;
}

// ========== CHART ==========
async function loadChart() {
  if (!state.symbol) return;
  try {
    const url = `/api/chart?symbol=${encodeURIComponent(state.symbol)}&interval=${state.interval}&range=${state.range}`;
    const data = await fetch(url).then(r => r.json());
    if (!data.candles) return;
    renderChart(data.candles);
  } catch (e) { console.error("loadChart", e); }
}

function recreateChart() {
  if (state.chart) { state.chart.remove(); state.chart = null; }
  if (state.symbol) loadChart();
}

function renderChart(candles) {
  const el = $("#chart");
  const dark = document.body.dataset.theme === "dark";
  const colors = dark
    ? { bg:"#18223b", text:"#e7ecf5", grid:"#2b3658", up:"#2ecc71", dn:"#ff5c7a" }
    : { bg:"#ffffff", text:"#1a2342", grid:"#d8dfee", up:"#1aa055", dn:"#d63a59" };

  if (!state.chart) {
    state.chart = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: { background: { color: colors.bg }, textColor: colors.text, fontSize: 11 },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      timeScale: { borderColor: colors.grid, timeVisible: state.interval.includes("m") || state.interval.includes("h") },
      rightPriceScale: { borderColor: colors.grid },
      crosshair: { mode: 1 },
      localization: { locale: "ja-JP" },
    });
  } else {
    state.chart.applyOptions({
      layout: { background: { color: colors.bg }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
    });
    if (state.series) state.chart.removeSeries(state.series);
  }

  if (state.ctype === "candle") {
    state.series = state.chart.addCandlestickSeries({
      upColor: colors.up, downColor: colors.dn,
      borderUpColor: colors.up, borderDownColor: colors.dn,
      wickUpColor: colors.up, wickDownColor: colors.dn,
    });
    state.series.setData(candles.map(c => ({
      time: c.t, open: c.o, high: c.h, low: c.l, close: c.c,
    })));
  } else if (state.ctype === "line") {
    state.series = state.chart.addLineSeries({ color: colors.up, lineWidth: 2 });
    state.series.setData(candles.map(c => ({ time: c.t, value: c.c })));
  } else {
    state.series = state.chart.addAreaSeries({
      lineColor: colors.up,
      topColor: dark ? "rgba(46,204,113,.4)" : "rgba(26,160,85,.3)",
      bottomColor: dark ? "rgba(46,204,113,.0)" : "rgba(26,160,85,.0)",
      lineWidth: 2,
    });
    state.series.setData(candles.map(c => ({ time: c.t, value: c.c })));
  }

  state.chart.timeScale().fitContent();
}

// ========== SUMMARY (財務) ==========
async function loadSummary() {
  if (!state.symbol) return;
  try {
    const data = await fetch(`/api/summary?symbol=${encodeURIComponent(state.symbol)}`).then(r => r.json());
    // ROE
    const roe = data?.financialData?.returnOnEquity?.raw;
    state.summaryROE = roe != null ? roe * 100 : null;
    if (state.summaryROE != null) {
      const sc = scoreLinear(state.summaryROE, 0, 20);
      setScore("roe", sc, `${fmt(state.summaryROE,2)}%`);
    } else setScore("roe", null, "--");

    // earnings
    state.earnings = data?.incomeStatementHistory?.incomeStatementHistory || [];
    renderEarnings();

    // profile
    const a = data?.assetProfile || {};
    $("#p-sector").textContent = a.industry || a.sector || "--";
    $("#p-employees").textContent = a.fullTimeEmployees ? a.fullTimeEmployees.toLocaleString("ja-JP") + "人" : "--";
    $("#p-address").textContent = [a.address1, a.city, a.country].filter(Boolean).join(" ") || "--";
    $("#p-summary").textContent = a.longBusinessSummary || "--";
  } catch (e) { console.error("loadSummary", e); }
}

function renderEarnings() {
  const el = $("#earnings-bars");
  if (!state.earnings || !state.earnings.length) { el.innerHTML = '<div class="sc-empty">データなし</div>'; return; }
  const data = state.earnings.slice().reverse(); // 古い→新しい

  let key, label;
  if (state.earnMetric === "revenue") { key = "totalRevenue"; label = "売上"; }
  else if (state.earnMetric === "profit") { key = "netIncome"; label = "純利益"; }
  else { key = "epsActual"; label = "EPS"; }

  // EPSは別経路（earnings.financialsChart）。incomeStatementには無いのでnetIncome/sharesOutstanding等で代用は省略、ここでは純利益のみ
  if (state.earnMetric === "eps") key = "netIncome"; // フォールバック

  const vals = data.map(d => ({
    year: d.endDate?.fmt?.slice(0,4) || "--",
    val: d[key]?.raw ?? null,
  })).filter(v => v.val != null);

  if (!vals.length) { el.innerHTML = '<div class="sc-empty">データなし</div>'; return; }
  const max = Math.max(...vals.map(v => Math.abs(v.val)));
  el.innerHTML = vals.map(v => {
    const h = Math.max(2, Math.round(Math.abs(v.val)/max*100));
    const neg = v.val < 0;
    return `
      <div class="bar">
        <div class="bar-value">${fmtAuto(v.val)}</div>
        <div class="bar-rect ${neg ? 'neg' : ''}" style="height:${h}%" data-val="${label} ${fmtAuto(v.val)}"></div>
        <div class="bar-label">${v.year}</div>
      </div>`;
  }).join("");
}

// ========== WATCHLIST ==========
function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem("kabu_watchlist") || "[]"); }
  catch { return []; }
}
function saveWatchlist() {
  localStorage.setItem("kabu_watchlist", JSON.stringify(state.watchlist));
}
function addToWatchlist(symbol, name) {
  if (state.watchlist.some(w => w.symbol === symbol)) return;
  state.watchlist.push({ symbol, name });
  saveWatchlist();
  renderWatchlist();
  refreshWatchlistAll();
}
function removeFromWatchlist(symbol) {
  state.watchlist = state.watchlist.filter(w => w.symbol !== symbol);
  saveWatchlist();
  renderWatchlist();
}
function renderWatchlist() {
  const el = $("#watchlist");
  if (!state.watchlist.length) {
    el.innerHTML = '<li style="cursor:default;border:1px dashed var(--line);justify-content:center;color:var(--muted);font-size:.75rem">「＋追加」で銘柄登録</li>';
    return;
  }
  el.innerHTML = state.watchlist.map(w => `
    <li data-symbol="${w.symbol}">
      <span class="w-sym">${w.symbol.replace(".T","")}</span>
      <span class="w-name">${w.name || w.symbol}</span>
      <span class="w-pct" data-pct>--</span>
      <button class="w-del" title="削除">×</button>
    </li>`).join("");
  el.querySelectorAll("li").forEach(li => {
    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("w-del")) return;
      selectSymbol(li.dataset.symbol);
    });
    li.querySelector(".w-del").addEventListener("click", (e) => {
      e.stopPropagation();
      removeFromWatchlist(li.dataset.symbol);
    });
  });
  refreshWatchlistAll();
}
async function refreshWatchlistAll() {
  if (!state.watchlist.length) return;
  const symbols = state.watchlist.map(w => w.symbol).join(",");
  try {
    const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`).then(r => r.json());
    (r?.quoteResponse?.result || []).forEach(q => refreshWatchlistRow(q.symbol, q));
  } catch (e) { console.error(e); }
}
function refreshWatchlistRow(symbol, q) {
  const li = $(`#watchlist li[data-symbol="${symbol}"]`);
  if (!li) return;
  const pct = q.regularMarketChangePercent ?? 0;
  const span = li.querySelector("[data-pct]");
  span.textContent = `${pct>=0?"+":""}${fmt(pct,2)}%`;
  span.classList.remove("up","dn");
  span.classList.add(pct>=0?"up":"dn");
}

// ========== POPULAR ==========
function renderPopular() {
  const el = $("#popular-groups");
  el.innerHTML = Object.entries(state.popular.groups).map(([name, items], i) => `
    <details ${i===0?"open":""}>
      <summary>${name}</summary>
      <ul>
        ${items.map(it => `<li data-symbol="${it.code}.T"><span>${it.name}</span><span class="pop-code">${it.code}</span></li>`).join("")}
      </ul>
    </details>`).join("");
  el.querySelectorAll("li").forEach(li => li.addEventListener("click", () => selectSymbol(li.dataset.symbol)));
}

// ========== SCREENER ==========
async function runScreener() {
  const group = $("#sc-group").value;
  const perMax = parseFloat($("#sc-per").value) || null;
  const pbrMax = parseFloat($("#sc-pbr").value) || null;
  const yldMin = parseFloat($("#sc-yield").value) || null;
  const mcapMin = parseFloat($("#sc-mcap").value) || null; // 億円
  const list = state.popular.groups[group] || [];
  const result = $("#sc-result");
  result.innerHTML = '<div class="sc-loading">取得中…<span class="loading"></span></div>';

  try {
    const symbols = list.map(it => `${it.code}.T`).join(",");
    const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`).then(r => r.json());
    const quotes = r?.quoteResponse?.result || [];
    const filtered = quotes.filter(q => {
      const per = q.trailingPE;
      const pbr = q.priceToBook;
      const yld = q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : (q.dividendYield ?? null);
      const mcapOku = q.marketCap ? q.marketCap / 1e8 : null;
      if (perMax != null && (per == null || per > perMax)) return false;
      if (pbrMax != null && (pbr == null || pbr > pbrMax)) return false;
      if (yldMin != null && (yld == null || yld < yldMin)) return false;
      if (mcapMin != null && (mcapOku == null || mcapOku < mcapMin)) return false;
      return true;
    }).sort((a,b)=>(b.marketCap||0)-(a.marketCap||0));

    if (!filtered.length) { result.innerHTML = '<div class="sc-empty">該当なし。条件をゆるめてください</div>'; return; }
    result.innerHTML = filtered.map(q => `
      <div class="sc-row" data-symbol="${q.symbol}">
        <span class="sc-sym">${q.symbol.replace(".T","")}</span>
        <span class="sc-name">${q.shortName || q.longName || ""}</span>
        <span class="sc-meta">PER ${fmt(q.trailingPE,1)}<br>PBR ${fmt(q.priceToBook,2)}</span>
      </div>`).join("");
    result.querySelectorAll(".sc-row").forEach(row => row.addEventListener("click", () => selectSymbol(row.dataset.symbol)));
  } catch (e) {
    console.error(e);
    result.innerHTML = '<div class="sc-empty">エラーが発生しました</div>';
  }
}

// ========== UTILS ==========
function fmt(v, d=2) {
  if (v == null || isNaN(v)) return "--";
  return Number(v).toLocaleString("ja-JP", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtVol(v) {
  if (v == null) return "--";
  if (v >= 1e8) return (v/1e8).toFixed(2)+"億";
  if (v >= 1e4) return (v/1e4).toFixed(0)+"万";
  return v.toLocaleString("ja-JP");
}
function fmtCap(v) {
  if (v == null) return "--";
  if (v >= 1e12) return (v/1e12).toFixed(2)+"兆";
  if (v >= 1e8) return (v/1e8).toFixed(0)+"億";
  return v.toLocaleString("ja-JP");
}
function fmtAuto(v) {
  if (v == null) return "--";
  if (Math.abs(v) >= 1e12) return (v/1e12).toFixed(1)+"兆";
  if (Math.abs(v) >= 1e8) return (v/1e8).toFixed(0)+"億";
  if (Math.abs(v) >= 1e4) return (v/1e4).toFixed(0)+"万";
  return v.toLocaleString("ja-JP");
}
