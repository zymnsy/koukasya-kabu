// 光菓舎-Kabu / 高精度版
// テクニカル6指標・10年ファンダ・配当・アナリスト・F-Score・損益シミュ・他社比較

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ========== STATE ==========
const state = {
  symbol: null,
  range: "3mo",
  interval: "1d",
  ctype: "candle",
  chart: null,
  rsiChart: null,
  macdChart: null,
  series: { main:null, sma5:null, sma25:null, sma75:null, sma200:null, bbU:null, bbM:null, bbL:null, vol:null, rsi:null, macdMacd:null, macdSig:null, macdHist:null },
  candles: [],
  refreshTimer: null,
  watchlist: loadWatchlist(),
  popular: null,
  earningsAnnual: null,
  cfAnnual: null,
  bsAnnual: null,
  earningsTrend: null,
  earnMetric: "revenue",
  summary: null,
  quote: null,
  indicators: { sma5:true, sma25:true, sma75:false, sma200:false, ichimoku:false, bb:false, vwap:false, vol:true, rsi:false, macd:false, stoch:false, atr:false },
  symbolMaster: [],
  compareSymbols: [],   // 重ね描き用追加銘柄
  compareSeries: {},    // {symbol: lineSeries}
  compareCandles: {},   // {symbol: candles}
  stochChart: null,
  atrChart: null,
};

// ========== INIT ==========
init().catch(err => console.error("init error", err));

async function init() {
  const theme = localStorage.getItem("kabu_theme") || "dark";
  document.body.dataset.theme = theme;
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = cur;
    localStorage.setItem("kabu_theme", cur);
    if (state.chart) recreateChart();
  });

  state.popular = await fetch("./data/popular.json").then(r => r.json());
  state.symbolMaster = await fetch("./data/symbols.json").then(r => r.json()).catch(() => []);
  renderPopular();
  renderWatchlist();

  setupSearch();

  $$(".range-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.range = btn.dataset.range;
    state.interval = btn.dataset.interval;
    if (state.symbol) loadChart();
  }));

  $$(".ctype-btn").forEach(btn => btn.addEventListener("click", () => {
    $$(".ctype-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.ctype = btn.dataset.ctype;
    if (state.symbol) recreateChart();
  }));

  $$(".ind-toggle").forEach(cb => cb.addEventListener("change", () => {
    state.indicators[cb.dataset.ind] = cb.checked;
    if (state.symbol) renderIndicators();
  }));

  $$(".earn-tab").forEach(btn => btn.addEventListener("click", () => {
    $$(".earn-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.earnMetric = btn.dataset.metric;
    renderEarnings();
  }));

  $("#refresh-now").addEventListener("click", () => { if (state.symbol) loadAll(); });

  $("#watch-add").addEventListener("click", () => {
    if (!state.symbol) return;
    addToWatchlist(state.symbol, $("#t-name").textContent);
  });

  $("#sc-run").addEventListener("click", runScreener);

  $("#sim-price").addEventListener("input", renderSimulator);
  $("#sim-shares").addEventListener("input", renderSimulator);

  const last = localStorage.getItem("kabu_last_symbol") || "7203.T";
  selectSymbol(last);

  window.addEventListener("resize", () => {
    [state.chart, state.rsiChart, state.macdChart].forEach(c => {
      if (c) {
        const el = c._kabuEl; if (el) c.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      }
    });
  });

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
      const isJP = /[ぁ-んァ-ヶー一-龠]/.test(q);
      const local = localSearch(q);
      let api = [];
      if (!isJP) {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => ({ items: [] }));
        api = r.items || [];
      }
      // 重複排除（local優先）
      const seen = new Set(local.map(i => i.symbol));
      items = [...local, ...api.filter(i => !seen.has(i.symbol))];
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
  loadNote();
}

async function loadAll() {
  await Promise.all([loadQuote(), loadChart(), loadSummary(), loadPeers()]);
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
    state.quote = q;
    renderQuote(q);
    renderValuation(q);
    renderSimulator();
    refreshWatchlistRow(state.symbol, q);
  } catch (e) { console.error("loadQuote", e); }
}

function renderQuote(q) {
  $("#t-symbol").textContent = q.symbol;
  $("#t-name").textContent = q.longName || q.shortName || q.symbol;
  $("#t-exch").textContent = q.fullExchangeName || q.exchange || "";
  $("#market-tag").textContent = q.exchange || "JPX";

  const price = q.regularMarketPrice ?? null;
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
  $("#t-yield").textContent = pct(q.trailingAnnualDividendYield ?? (q.dividendYield != null ? q.dividendYield/100 : null));
  $("#t-eps").textContent = fmt(q.epsTrailingTwelveMonths, 2);
  $("#t-bps").textContent = fmt(q.bookValue, 2);
  $("#t-52h").textContent = fmt(q.fiftyTwoWeekHigh, 2);
  $("#t-52l").textContent = fmt(q.fiftyTwoWeekLow, 2);
}

// ========== VALUATION ==========
function renderValuation(q) {
  const per = q.trailingPE;
  setScore("per", scoreInverted(per, 5, 30), per != null ? `${fmt(per,2)}倍` : "--");

  const pbr = q.priceToBook;
  setScore("pbr", scoreInverted(pbr, 0.5, 3), pbr != null ? `${fmt(pbr,2)}倍` : "--");

  const yld = q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : (q.dividendYield ?? null);
  setScore("yield", scoreLinear(yld, 0, 6), yld != null ? `${fmt(yld,2)}%` : "--");

  const roe = state.summary?.financialData?.returnOnEquity?.raw;
  if (roe != null) {
    const roePct = roe * 100;
    setScore("roe", scoreLinear(roePct, 0, 20), `${fmt(roePct,2)}%`);
    $("#t-roe").textContent = `${fmt(roePct,2)}%`;
  } else setScore("roe", null, "--");

  const roa = state.summary?.financialData?.returnOnAssets?.raw;
  $("#t-roa").textContent = roa != null ? `${fmt(roa*100,2)}%` : "--";

  // 自己資本比率（最新BSから）
  const eqRatio = computeEquityRatio();
  $("#t-equity").textContent = eqRatio != null ? `${fmt(eqRatio,1)}%` : "--";

  // EV/EBITDA
  const evEbitda = state.summary?.defaultKeyStatistics?.enterpriseToEbitda?.raw;
  $("#t-evebitda").textContent = fmt(evEbitda, 2);

  // PEG（PER ÷ 利益成長率）— earningsTrendの+1y成長率を使う
  const peg = state.summary?.defaultKeyStatistics?.pegRatio?.raw;
  setScore("peg", scoreInverted(peg, 0.5, 3), peg != null ? `${fmt(peg,2)}` : "--");

  // グレアム指数 = PER × PBR  （22.5以下が割安目安）
  let graham = null;
  if (per != null && pbr != null) graham = per * pbr;
  setScore("graham", scoreInverted(graham, 5, 60), graham != null ? `${fmt(graham,1)}（22.5以下が目安）` : "--");

  const scores = ["per","pbr","yield","roe","peg","graham"]
    .map(k => parseInt(($(`#score-${k}`).style.width || "0").replace("%","")) || null)
    .filter(s => s !== null && s > 0);
  const avg = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : null;
  let verdict = "判定不可";
  if (avg != null) {
    if (avg >= 70) verdict = `🟢 総合${Math.round(avg)}点：割安寄り（バリュー候補）`;
    else if (avg >= 55) verdict = `🟡 総合${Math.round(avg)}点：中立（他指標と組合せ要）`;
    else if (avg >= 35) verdict = `🟠 総合${Math.round(avg)}点：やや割高（成長性で説明できるか）`;
    else verdict = `🔴 総合${Math.round(avg)}点：割高水準（期待先行に注意）`;
  }
  $("#verdict").textContent = verdict;
}

function computeEquityRatio() {
  const bs = state.summary?.balanceSheetHistory?.balanceSheetStatements?.[0];
  if (!bs) return null;
  const equity = bs.totalStockholderEquity?.raw;
  const assets = bs.totalAssets?.raw;
  if (!equity || !assets) return null;
  return (equity / assets) * 100;
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
  if (!fill) return;
  if (score == null) { fill.style.width = "0%"; t.textContent = text; return; }
  fill.style.width = `${score}%`;
  t.textContent = `${text}（${score}点）`;
}

// ========== CHART ==========
async function loadChart() {
  if (!state.symbol) return;
  try {
    const url = `/api/chart?symbol=${encodeURIComponent(state.symbol)}&interval=${state.interval}&range=${state.range}`;
    const data = await fetch(url).then(r => r.json());
    if (!data.candles) return;
    state.candles = data.candles;
    renderChart();
    renderIndicators();
    // 比較銘柄も同レンジで再取得
    state.compareCandles = {};
    for (const s of state.compareSymbols) loadCompareSymbol(s);
  } catch (e) { console.error("loadChart", e); }
}

function recreateChart() {
  if (state.chart) { state.chart.remove(); state.chart = null; }
  if (state.rsiChart) { state.rsiChart.remove(); state.rsiChart = null; }
  if (state.macdChart) { state.macdChart.remove(); state.macdChart = null; }
  for (const k in state.series) state.series[k] = null;
  if (state.symbol) { renderChart(); renderIndicators(); }
}

function chartColors() {
  const dark = document.body.dataset.theme === "dark";
  return dark
    ? { bg:"#18223b", text:"#e7ecf5", grid:"#2b3658", up:"#2ecc71", dn:"#ff5c7a", line1:"#7cc7ff", line2:"#ffc857", line3:"#a78bfa", line4:"#ff8c5c", bb:"rgba(124,199,255,.4)" }
    : { bg:"#ffffff", text:"#1a2342", grid:"#d8dfee", up:"#1aa055", dn:"#d63a59", line1:"#1d72c4", line2:"#c89515", line3:"#7c4dff", line4:"#d6633a", bb:"rgba(29,114,196,.4)" };
}

function renderChart() {
  if (!state.candles.length) return;
  const el = $("#chart");
  const c = chartColors();

  if (!state.chart) {
    state.chart = LightweightCharts.createChart(el, {
      width: el.clientWidth, height: el.clientHeight,
      layout: { background: { color: c.bg }, textColor: c.text, fontSize: 11 },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      timeScale: { borderColor: c.grid, timeVisible: state.interval.includes("m") || state.interval.includes("h") },
      rightPriceScale: { borderColor: c.grid, scaleMargins: { top: .08, bottom: .25 } },
      crosshair: { mode: 1 },
      localization: { locale: "ja-JP" },
    });
    state.chart._kabuEl = el;
  }
  // メインシリーズ
  if (state.series.main) state.chart.removeSeries(state.series.main);
  if (state.ctype === "candle") {
    state.series.main = state.chart.addCandlestickSeries({
      upColor: c.up, downColor: c.dn, borderUpColor: c.up, borderDownColor: c.dn,
      wickUpColor: c.up, wickDownColor: c.dn,
    });
    state.series.main.setData(state.candles.map(c1 => ({ time: c1.t, open: c1.o, high: c1.h, low: c1.l, close: c1.c })));
  } else if (state.ctype === "line") {
    state.series.main = state.chart.addLineSeries({ color: c.up, lineWidth: 2 });
    state.series.main.setData(state.candles.map(c1 => ({ time: c1.t, value: c1.c })));
  } else {
    state.series.main = state.chart.addAreaSeries({
      lineColor: c.up,
      topColor: document.body.dataset.theme === "dark" ? "rgba(46,204,113,.4)" : "rgba(26,160,85,.3)",
      bottomColor: "rgba(46,204,113,.0)", lineWidth: 2,
    });
    state.series.main.setData(state.candles.map(c1 => ({ time: c1.t, value: c1.c })));
  }
  state.chart.timeScale().fitContent();
}

function renderIndicators() {
  if (!state.chart || !state.candles.length) return;
  const c = chartColors();
  const closes = state.candles.map(d => d.c);

  // SMA
  for (const p of [5,25,75,200]) {
    const key = `sma${p}`;
    if (state.series[key]) { state.chart.removeSeries(state.series[key]); state.series[key] = null; }
    if (state.indicators[key]) {
      const sma = SMA(closes, p);
      const colorMap = { sma5:c.line1, sma25:c.line2, sma75:c.line3, sma200:c.line4 };
      state.series[key] = state.chart.addLineSeries({ color: colorMap[key], lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      state.series[key].setData(state.candles.map((d,i) => ({ time: d.t, value: sma[i] })).filter(d => d.value != null));
    }
  }

  // ボリンジャー
  ["bbU","bbM","bbL"].forEach(k => { if (state.series[k]) { state.chart.removeSeries(state.series[k]); state.series[k]=null; }});
  if (state.indicators.bb) {
    const { upper, middle, lower } = BollingerBands(closes, 20, 2);
    state.series.bbU = state.chart.addLineSeries({ color: c.bb, lineWidth: 1, priceLineVisible:false, lastValueVisible:false });
    state.series.bbM = state.chart.addLineSeries({ color: c.bb, lineWidth: 1, lineStyle: 2, priceLineVisible:false, lastValueVisible:false });
    state.series.bbL = state.chart.addLineSeries({ color: c.bb, lineWidth: 1, priceLineVisible:false, lastValueVisible:false });
    state.series.bbU.setData(state.candles.map((d,i) => ({ time: d.t, value: upper[i] })).filter(d => d.value != null));
    state.series.bbM.setData(state.candles.map((d,i) => ({ time: d.t, value: middle[i] })).filter(d => d.value != null));
    state.series.bbL.setData(state.candles.map((d,i) => ({ time: d.t, value: lower[i] })).filter(d => d.value != null));
  }

  // 出来高
  if (state.series.vol) { state.chart.removeSeries(state.series.vol); state.series.vol = null; }
  if (state.indicators.vol) {
    state.series.vol = state.chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: c.line1,
    });
    state.chart.priceScale("vol").applyOptions({ scaleMargins: { top: .8, bottom: 0 } });
    state.series.vol.setData(state.candles.map(d => ({
      time: d.t, value: d.v || 0,
      color: (d.c >= d.o) ? `${c.up}88` : `${c.dn}88`,
    })));
  }

  // RSI（サブパネル）
  const rsiEl = $("#chart-rsi");
  if (state.indicators.rsi) {
    rsiEl.classList.remove("hidden");
    if (!state.rsiChart) {
      state.rsiChart = LightweightCharts.createChart(rsiEl, {
        width: rsiEl.clientWidth, height: rsiEl.clientHeight,
        layout: { background: { color: c.bg }, textColor: c.text, fontSize: 10 },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        timeScale: { borderColor: c.grid, visible: false },
        rightPriceScale: { borderColor: c.grid },
        crosshair: { mode: 1 },
      });
      state.rsiChart._kabuEl = rsiEl;
    }
    if (state.series.rsi) state.rsiChart.removeSeries(state.series.rsi);
    state.series.rsi = state.rsiChart.addLineSeries({ color: c.line2, lineWidth: 1.5 });
    const rsi = RSI(closes, 14);
    state.series.rsi.setData(state.candles.map((d,i) => ({ time: d.t, value: rsi[i] })).filter(d => d.value != null));
    state.series.rsi.createPriceLine({ price: 70, color: c.dn, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
    state.series.rsi.createPriceLine({ price: 30, color: c.up, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
    state.rsiChart.timeScale().fitContent();
  } else {
    rsiEl.classList.add("hidden");
    if (state.rsiChart) { state.rsiChart.remove(); state.rsiChart = null; state.series.rsi = null; }
  }

  // MACD（サブパネル）
  const macdEl = $("#chart-macd");
  if (state.indicators.macd) {
    macdEl.classList.remove("hidden");
    if (!state.macdChart) {
      state.macdChart = LightweightCharts.createChart(macdEl, {
        width: macdEl.clientWidth, height: macdEl.clientHeight,
        layout: { background: { color: c.bg }, textColor: c.text, fontSize: 10 },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        timeScale: { borderColor: c.grid, visible: false },
        rightPriceScale: { borderColor: c.grid },
        crosshair: { mode: 1 },
      });
      state.macdChart._kabuEl = macdEl;
    }
    ["macdMacd","macdSig","macdHist"].forEach(k => { if (state.series[k]) { state.macdChart.removeSeries(state.series[k]); state.series[k]=null; }});
    const { macd, signal, hist } = MACD(closes, 12, 26, 9);
    state.series.macdHist = state.macdChart.addHistogramSeries({ color: c.line1 });
    state.series.macdHist.setData(state.candles.map((d,i) => ({
      time: d.t, value: hist[i],
      color: hist[i] >= 0 ? `${c.up}aa` : `${c.dn}aa`,
    })).filter(d => d.value != null));
    state.series.macdMacd = state.macdChart.addLineSeries({ color: c.line1, lineWidth: 1.5 });
    state.series.macdSig = state.macdChart.addLineSeries({ color: c.line2, lineWidth: 1.5 });
    state.series.macdMacd.setData(state.candles.map((d,i) => ({ time: d.t, value: macd[i] })).filter(d => d.value != null));
    state.series.macdSig.setData(state.candles.map((d,i) => ({ time: d.t, value: signal[i] })).filter(d => d.value != null));
    state.macdChart.timeScale().fitContent();
  } else {
    macdEl.classList.add("hidden");
    if (state.macdChart) { state.macdChart.remove(); state.macdChart = null; state.series.macdMacd = state.series.macdSig = state.series.macdHist = null; }
  }

  // 拡張指標（一目・VWAP・ストキャス・ATR・比較銘柄）
  renderExtraIndicators();
}

// ========== TECHNICAL INDICATORS ==========
function SMA(arr, p) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= p) sum -= arr[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}
function EMA(arr, p) {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (p + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (i < p - 1) continue;
    if (prev == null) {
      let s = 0; for (let j = i - p + 1; j <= i; j++) s += arr[j];
      prev = s / p;
    } else {
      prev = arr[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}
function BollingerBands(arr, p, k) {
  const sma = SMA(arr, p);
  const upper = new Array(arr.length).fill(null);
  const lower = new Array(arr.length).fill(null);
  for (let i = p - 1; i < arr.length; i++) {
    let sumSq = 0;
    for (let j = i - p + 1; j <= i; j++) sumSq += (arr[j] - sma[i]) ** 2;
    const sd = Math.sqrt(sumSq / p);
    upper[i] = sma[i] + k * sd;
    lower[i] = sma[i] - k * sd;
  }
  return { upper, middle: sma, lower };
}
function RSI(arr, p) {
  const out = new Array(arr.length).fill(null);
  if (arr.length <= p) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= p; i++) {
    const d = arr[i] - arr[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / p, avgL = losses / p;
  out[p] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = p + 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    avgG = (avgG * (p - 1) + g) / p;
    avgL = (avgL * (p - 1) + l) / p;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}
function MACD(arr, fast, slow, sig) {
  const e1 = EMA(arr, fast);
  const e2 = EMA(arr, slow);
  const macd = arr.map((_, i) => (e1[i] != null && e2[i] != null) ? e1[i] - e2[i] : null);
  const macdValid = macd.filter(v => v != null);
  const sigEma = EMA(macdValid, sig);
  const signal = new Array(arr.length).fill(null);
  let validIdx = 0;
  for (let i = 0; i < arr.length; i++) {
    if (macd[i] != null) { signal[i] = sigEma[validIdx]; validIdx++; }
  }
  const hist = arr.map((_, i) => (macd[i] != null && signal[i] != null) ? macd[i] - signal[i] : null);
  return { macd, signal, hist };
}

// ========== SUMMARY (財務拡張) ==========
async function loadSummary() {
  if (!state.symbol) return;
  try {
    const data = await fetch(`/api/summary?symbol=${encodeURIComponent(state.symbol)}`).then(r => r.json());
    state.summary = data;
    state.earningsAnnual = data?.incomeStatementHistory?.incomeStatementHistory || [];
    state.cfAnnual = data?.cashflowStatementHistory?.cashflowStatements || [];
    state.bsAnnual = data?.balanceSheetHistory?.balanceSheetStatements || [];
    state.earningsTrend = data?.earningsTrend?.trend || [];

    // valuation 再計算（ROE/PEG/EVなど）
    if (state.quote) renderValuation(state.quote);
    renderEarnings();
    renderDividend();
    renderAnalyst();
    renderProfile();
    renderFScore();
    renderUpgrades();
    renderHolders();
  } catch (e) { console.error("loadSummary", e); }
}

function renderEarnings() {
  const el = $("#earnings-bars");
  const meta = $("#earn-meta");
  if (!state.earningsAnnual?.length) { el.innerHTML = '<div class="sc-empty">データなし</div>'; meta.innerHTML = ""; return; }

  const m = state.earnMetric;
  let label, getter;
  if (m === "revenue") { label="売上"; getter = (e) => e.totalRevenue?.raw; }
  else if (m === "opIncome") { label="営業利益"; getter = (e) => e.operatingIncome?.raw ?? e.ebit?.raw; }
  else if (m === "netIncome") { label="純利益"; getter = (e) => e.netIncome?.raw; }
  else if (m === "eps") { label="EPS"; getter = () => null; /* 個別経路 */ }
  else if (m === "opcf") { label="営業CF"; getter = (_e, _b, cf) => cf?.totalCashFromOperatingActivities?.raw; }
  else if (m === "fcf") { label="FCF"; getter = (_e, _b, cf) => {
      const op = cf?.totalCashFromOperatingActivities?.raw;
      const cap = cf?.capitalExpenditures?.raw;
      return (op != null && cap != null) ? op + cap : null;
    };
  }

  // 年度マッチ
  const data = state.earningsAnnual.slice().reverse(); // 古→新
  const cfRev = (state.cfAnnual||[]).slice().reverse();
  const bsRev = (state.bsAnnual||[]).slice().reverse();

  const vals = data.map((e, i) => ({
    year: e.endDate?.fmt?.slice(0,4) || "--",
    val: getter(e, bsRev[i], cfRev[i]),
  })).filter(v => v.val != null);

  // EPSは earnings.financialsChart.yearly から
  if (m === "eps") {
    const yr = state.summary?.earnings?.financialsChart?.yearly || [];
    vals.length = 0;
    yr.forEach(y => { if (y.earnings?.raw != null && y.revenue?.raw) {
      // EPS = 純利益/発行済株式 ≒ 提供データなし、代用としてearningsをepsとする
    }});
    // フォールバック：earningsHistoryから（四半期EPS年合計近似）
    const eh = state.summary?.earningsHistory?.history || [];
    const byYr = {};
    eh.forEach(h => { const yr = h.quarter?.fmt?.slice(0,4); if (!yr) return; byYr[yr] = (byYr[yr]||0) + (h.epsActual?.raw||0); });
    Object.entries(byYr).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([yr,v])=>{
      if (v) vals.push({ year: yr, val: v });
    });
  }

  if (!vals.length) { el.innerHTML = '<div class="sc-empty">データなし</div>'; meta.innerHTML=""; return; }
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

  // 成長率
  const yoy = vals.length >= 2 && vals[vals.length-2].val ? (vals[vals.length-1].val / vals[vals.length-2].val - 1) * 100 : null;
  let cagr = null;
  if (vals.length >= 4 && vals[0].val && vals[vals.length-1].val && vals[0].val > 0) {
    const n = vals.length - 1;
    cagr = (Math.pow(vals[vals.length-1].val / vals[0].val, 1/n) - 1) * 100;
  }
  const yoyTxt = yoy != null ? `<span class="${yoy>=0?'pos':'neg'}">${yoy>=0?'+':''}${fmt(yoy,1)}%</span>` : "--";
  const cagrTxt = cagr != null ? `<span class="${cagr>=0?'pos':'neg'}">${cagr>=0?'+':''}${fmt(cagr,1)}%</span>` : "--";
  meta.innerHTML = `<strong>${label}</strong> ｜ 前年比(YoY): ${yoyTxt} ｜ 過去${vals.length-1}年CAGR: ${cagrTxt}`;
}

// ========== DIVIDEND ==========
function renderDividend() {
  const sd = state.summary?.summaryDetail || {};
  const ks = state.summary?.defaultKeyStatistics || {};
  const yld = sd.dividendYield?.raw ?? sd.trailingAnnualDividendYield?.raw;
  const rate = sd.dividendRate?.raw ?? sd.trailingAnnualDividendRate?.raw;
  const payout = sd.payoutRatio?.raw;
  const fiveY = sd.fiveYearAvgDividendYield?.raw;
  const exDate = sd.exDividendDate?.fmt;

  $("#d-yield").textContent = yld != null ? `${fmt(yld*100,2)}%` : "--";
  $("#d-rate").textContent = rate != null ? `${fmt(rate,0)}円` : "--";
  $("#d-payout").textContent = payout != null ? `${fmt(payout*100,1)}%` : "--";
  $("#d-5y").textContent = fiveY != null ? `${fmt(fiveY,2)}%` : "--";
  $("#d-exdate").textContent = exDate || "--";

  // 連続増配傾向：5年配当履歴がない場合は、5年平均と現在配当を比較
  let streakTxt = "--";
  if (yld != null && fiveY != null) {
    const cur = yld*100;
    if (cur > fiveY * 1.1) streakTxt = "📈 増配傾向（5年平均超え）";
    else if (cur < fiveY * 0.9) streakTxt = "📉 減配傾向";
    else streakTxt = "➡ ほぼ横ばい";
  }
  $("#d-streak").textContent = streakTxt;
}

// ========== ANALYST ==========
function renderAnalyst() {
  const fd = state.summary?.financialData || {};
  const target = fd.targetMeanPrice?.raw;
  const cur = state.quote?.regularMarketPrice;
  const upside = (target && cur) ? (target/cur - 1) * 100 : null;
  const reco = fd.recommendationMean?.raw;
  const recoKey = fd.recommendationKey;
  const count = fd.numberOfAnalystOpinions?.raw;

  $("#a-target").textContent = target != null ? `${fmt(target,0)}円` : "--";
  $("#a-upside").innerHTML = upside != null ? `<span class="${upside>=0?'up':'dn'}">${upside>=0?'+':''}${fmt(upside,1)}%</span>` : "--";
  const recoMap = { strong_buy: "強い買い", buy: "買い", hold: "中立", sell: "売り", strong_sell: "強い売り" };
  $("#a-reco").textContent = recoKey ? `${recoMap[recoKey]||recoKey} (${fmt(reco,2)})` : "--";
  $("#a-count").textContent = count != null ? `${count}名` : "--";

  // recommendationTrend からセグメントバー
  const trend = state.summary?.recommendationTrend?.trend?.[0];
  if (trend) {
    const sb = trend.strongBuy||0, b = trend.buy||0, h = trend.hold||0, s = trend.sell||0, ss = trend.strongSell||0;
    const total = sb+b+h+s+ss;
    if (total > 0) {
      const seg = (n,cls,label) => n>0 ? `<div class="reco-seg ${cls}" style="flex:${n}">${label}${n}</div>` : "";
      $("#reco-bar").innerHTML = seg(sb,"reco-strongbuy","強買")+seg(b,"reco-buy","買")+seg(h,"reco-hold","中")+seg(s,"reco-sell","売")+seg(ss,"reco-strongsell","強売");
    } else $("#reco-bar").innerHTML = "";
  }

  // 次回決算
  const cal = state.summary?.calendarEvents?.earnings?.earningsDate;
  if (cal && cal[0]?.fmt) $("#a-next").textContent = `次回決算: ${cal[0].fmt}`;
  else $("#a-next").textContent = "次回決算: 未定";
}

// ========== PROFILE ==========
function renderProfile() {
  const a = state.summary?.assetProfile || {};
  $("#p-sector").textContent = a.industryDisp || a.industry || a.sector || "--";
  $("#p-employees").textContent = a.fullTimeEmployees ? a.fullTimeEmployees.toLocaleString("ja-JP") + "人" : "--";
  $("#p-address").textContent = [a.address1, a.city, a.country].filter(Boolean).join(" ") || "--";
  $("#p-summary").textContent = a.longBusinessSummary || "--";
}

// ========== F-SCORE (Piotroski 9項目) ==========
function renderFScore() {
  const items = computeFScore();
  const el = $("#fscore-list");
  el.innerHTML = items.map(it => {
    const cls = it.pass === true ? "fs-pass" : it.pass === false ? "fs-fail" : "fs-na";
    const mark = it.pass === true ? "✓ +1" : it.pass === false ? "✗ 0" : "—";
    return `<div class="fs-item"><span>${it.label}</span><span class="${cls}">${mark}</span></div>`;
  }).join("");
  const total = items.filter(i => i.pass === true).length;
  const valid = items.filter(i => i.pass != null).length;
  let interp = "";
  if (valid >= 6) {
    if (total >= 7) interp = "🟢 高スコア（財務健全・改善傾向）";
    else if (total >= 4) interp = "🟡 中位スコア";
    else interp = "🔴 低スコア（財務に注意点あり）";
  } else interp = "（データ不足、参考値）";
  $("#fscore-total").innerHTML = `合計 <span style="font-size:1.4rem;color:var(--primary)">${total}</span> / 9 ${interp}`;
}

function computeFScore() {
  const inc = state.earningsAnnual || [];
  const cf = state.cfAnnual || [];
  const bs = state.bsAnnual || [];
  // 直近2期（[0]=最新, [1]=前期）
  const i0=inc[0], i1=inc[1], c0=cf[0], c1=cf[1], b0=bs[0], b1=bs[1];

  const get = (o,k) => o?.[k]?.raw;
  const safeDiv = (a,b) => (a!=null && b) ? a/b : null;

  const items = [];

  // 1. 当期純利益 > 0
  const ni0 = get(i0,"netIncome");
  items.push({ label: "①当期純利益 > 0", pass: ni0 != null ? ni0 > 0 : null });

  // 2. 営業CF > 0
  const ocf0 = get(c0,"totalCashFromOperatingActivities");
  items.push({ label: "②営業CF > 0", pass: ocf0 != null ? ocf0 > 0 : null });

  // 3. ROA改善（当期ROA > 前期ROA）
  const a0 = get(b0,"totalAssets"), a1 = get(b1,"totalAssets");
  const ni1 = get(i1,"netIncome");
  const roa0 = safeDiv(ni0, a0), roa1 = safeDiv(ni1, a1);
  items.push({ label: "③ROA前年比 改善", pass: (roa0!=null && roa1!=null) ? roa0 > roa1 : null });

  // 4. 営業CF > 当期純利益（質の高い利益）
  items.push({ label: "④営業CF > 純利益", pass: (ocf0!=null && ni0!=null) ? ocf0 > ni0 : null });

  // 5. 長期負債比率 低下
  const ltd0 = get(b0,"longTermDebt"), ltd1 = get(b1,"longTermDebt");
  const ld0 = safeDiv(ltd0, a0), ld1 = safeDiv(ltd1, a1);
  items.push({ label: "⑤長期負債比率 低下", pass: (ld0!=null && ld1!=null) ? ld0 < ld1 : null });

  // 6. 流動比率 改善
  const ca0 = get(b0,"totalCurrentAssets"), ca1 = get(b1,"totalCurrentAssets");
  const cl0 = get(b0,"totalCurrentLiabilities"), cl1 = get(b1,"totalCurrentLiabilities");
  const cr0 = safeDiv(ca0, cl0), cr1 = safeDiv(ca1, cl1);
  items.push({ label: "⑥流動比率 改善", pass: (cr0!=null && cr1!=null) ? cr0 > cr1 : null });

  // 7. 株式希薄化なし（発行済株式数が増えていない）
  const sh0 = get(b0,"commonStock"), sh1 = get(b1,"commonStock");
  items.push({ label: "⑦株式希薄化なし", pass: (sh0!=null && sh1!=null) ? sh0 <= sh1 * 1.001 : null });

  // 8. 売上総利益率 改善
  const rev0 = get(i0,"totalRevenue"), rev1 = get(i1,"totalRevenue");
  const gp0 = get(i0,"grossProfit"), gp1 = get(i1,"grossProfit");
  const gm0 = safeDiv(gp0, rev0), gm1 = safeDiv(gp1, rev1);
  items.push({ label: "⑧売上総利益率 改善", pass: (gm0!=null && gm1!=null) ? gm0 > gm1 : null });

  // 9. 資産回転率 改善
  const at0 = safeDiv(rev0, a0), at1 = safeDiv(rev1, a1);
  items.push({ label: "⑨総資産回転率 改善", pass: (at0!=null && at1!=null) ? at0 > at1 : null });

  return items;
}

// ========== SIMULATOR ==========
function renderSimulator() {
  const buy = parseFloat($("#sim-price").value);
  const shares = parseFloat($("#sim-shares").value) || 100;
  const cur = state.quote?.regularMarketPrice;
  const yld = state.summary?.summaryDetail?.dividendYield?.raw;
  const rate = state.summary?.summaryDetail?.dividendRate?.raw;
  const el = $("#sim-result");
  if (!buy || !cur) { el.textContent = "取得単価を入力してください"; return; }

  const cost = buy * shares;
  const value = cur * shares;
  const pl = value - cost;
  const plPct = (cur/buy - 1) * 100;
  const annDiv = (rate || (yld ? yld * cur : 0)) * shares;
  const yieldOnCost = rate ? (rate / buy) * 100 : (yld ? yld * cur / buy * 100 : null);

  const cls = pl >= 0 ? "up" : "dn";
  el.innerHTML = `
    <div>取得：${fmt(cost,0)}円 → 評価：<strong>${fmt(value,0)}円</strong></div>
    <span class="big ${cls}">${pl>=0?'+':''}${fmt(pl,0)}円（${pl>=0?'+':''}${fmt(plPct,2)}%）</span>
    <div>年間配当（概算）：<strong>${fmt(annDiv,0)}円</strong></div>
    <div>取得時利回り（YoC）：<strong>${yieldOnCost!=null?fmt(yieldOnCost,2)+'%':'--'}</strong></div>
  `;
}

// ========== PEERS ==========
async function loadPeers() {
  if (!state.symbol) return;
  try {
    const r = await fetch(`/api/peers?symbol=${encodeURIComponent(state.symbol)}`).then(r => r.json());
    const peers = (r.peers || []).slice(0, 5);
    const all = [state.symbol, ...peers.filter(p => p !== state.symbol)];
    if (!all.length) { renderPeers([]); return; }
    const q = await fetch(`/api/quote?symbols=${encodeURIComponent(all.join(","))}`).then(r => r.json());
    renderPeers(q?.quoteResponse?.result || []);
  } catch (e) { console.error("loadPeers", e); }
}

function renderPeers(quotes) {
  const tb = $("#peers-table tbody");
  if (!quotes.length) { tb.innerHTML = '<tr><td colspan="8" class="sc-empty">同業他社データ取得不可</td></tr>'; return; }
  tb.innerHTML = quotes.map(q => {
    const isSelf = q.symbol === state.symbol;
    const chgPct = q.regularMarketChangePercent ?? 0;
    const yld = q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : (q.dividendYield ?? null);
    return `
      <tr class="${isSelf?'self':''}" data-symbol="${q.symbol}">
        <td><span class="ticker-cell">${q.symbol.replace(".T","")}</span> ${q.shortName||q.longName||""}</td>
        <td>${fmt(q.regularMarketPrice,0)}</td>
        <td class="${chgPct>=0?'up':'dn'}">${chgPct>=0?'+':''}${fmt(chgPct,2)}%</td>
        <td>${fmt(q.trailingPE,2)}</td>
        <td>${fmt(q.priceToBook,2)}</td>
        <td>${yld!=null?fmt(yld,2)+'%':'--'}</td>
        <td>${fmtCap(q.marketCap)}</td>
        <td>--</td>
      </tr>`;
  }).join("");
  tb.querySelectorAll("tr").forEach(tr => {
    if (tr.classList.contains("self")) return;
    tr.addEventListener("click", () => selectSymbol(tr.dataset.symbol));
  });
}

// ========== WATCHLIST ==========
function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem("kabu_watchlist") || "[]"); }
  catch { return []; }
}
function saveWatchlist() { localStorage.setItem("kabu_watchlist", JSON.stringify(state.watchlist)); }
function addToWatchlist(symbol, name) {
  if (state.watchlist.some(w => w.symbol === symbol)) return;
  state.watchlist.push({ symbol, name });
  saveWatchlist(); renderWatchlist(); refreshWatchlistAll();
}
function removeFromWatchlist(symbol) {
  state.watchlist = state.watchlist.filter(w => w.symbol !== symbol);
  saveWatchlist(); renderWatchlist();
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
      e.stopPropagation(); removeFromWatchlist(li.dataset.symbol);
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
  const mcapMin = parseFloat($("#sc-mcap").value) || null;
  const roeMin = parseFloat($("#sc-roe").value) || null;
  const eqMin = parseFloat($("#sc-eq").value) || null;
  const list = state.popular.groups[group] || [];
  const result = $("#sc-result");
  result.innerHTML = '<div class="sc-loading">取得中…<span class="loading"></span></div>';

  try {
    const symbols = list.map(it => `${it.code}.T`).join(",");
    const r = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`).then(r => r.json());
    let quotes = r?.quoteResponse?.result || [];

    // ROE/自己資本要なら個別summary取得
    const needSummary = roeMin != null || eqMin != null;
    if (needSummary) {
      const ext = await Promise.all(quotes.map(async q => {
        try {
          const s = await fetch(`/api/summary?symbol=${encodeURIComponent(q.symbol)}`).then(r=>r.json());
          const roe = s?.financialData?.returnOnEquity?.raw;
          const bs = s?.balanceSheetHistory?.balanceSheetStatements?.[0];
          const eqR = (bs?.totalStockholderEquity?.raw && bs?.totalAssets?.raw) ? bs.totalStockholderEquity.raw/bs.totalAssets.raw*100 : null;
          return { ...q, _roe: roe!=null?roe*100:null, _eqRatio: eqR };
        } catch { return q; }
      }));
      quotes = ext;
    }

    const filtered = quotes.filter(q => {
      const per = q.trailingPE;
      const pbr = q.priceToBook;
      const yld = q.trailingAnnualDividendYield != null ? q.trailingAnnualDividendYield * 100 : (q.dividendYield ?? null);
      const mcapOku = q.marketCap ? q.marketCap / 1e8 : null;
      if (perMax != null && (per == null || per > perMax)) return false;
      if (pbrMax != null && (pbr == null || pbr > pbrMax)) return false;
      if (yldMin != null && (yld == null || yld < yldMin)) return false;
      if (mcapMin != null && (mcapOku == null || mcapOku < mcapMin)) return false;
      if (roeMin != null && (q._roe == null || q._roe < roeMin)) return false;
      if (eqMin != null && (q._eqRatio == null || q._eqRatio < eqMin)) return false;
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
function pct(v) { return v == null ? "--" : `${fmt(v*100,2)}%`; }
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

// ========== LOCAL SYMBOL SEARCH ==========
function localSearch(q) {
  if (!state.symbolMaster?.length) return [];
  const lq = q.toLowerCase();
  return state.symbolMaster
    .filter(it => it.c.startsWith(q) || it.n.includes(q) || it.n.toLowerCase().includes(lq) || (it.s||"").includes(q))
    .slice(0, 12)
    .map(it => ({ symbol: `${it.c}.T`, shortname: it.n, longname: it.n, exch: it.s || "東証" }));
}

// ========== COMPARE (multi-symbol overlay) ==========
function setupCompare() {
  $("#add-compare").addEventListener("click", () => {
    const v = prompt("比較する銘柄コード（4桁）または .T 付シンボル");
    if (!v) return;
    const sym = /^\d{4}$/.test(v.trim()) ? `${v.trim()}.T` : v.trim();
    if (sym === state.symbol || state.compareSymbols.includes(sym)) return;
    if (state.compareSymbols.length >= 4) { toast("比較は最大4銘柄まで", "error"); return; }
    state.compareSymbols.push(sym);
    saveCompare();
    loadCompareSymbol(sym);
    renderCompareList();
  });
}
function saveCompare() { localStorage.setItem("kabu_compare", JSON.stringify(state.compareSymbols)); }
function loadCompareFromStorage() {
  try { state.compareSymbols = JSON.parse(localStorage.getItem("kabu_compare") || "[]"); }
  catch { state.compareSymbols = []; }
}
async function loadCompareSymbol(sym) {
  try {
    const url = `/api/chart?symbol=${encodeURIComponent(sym)}&interval=${state.interval}&range=${state.range}`;
    const data = await fetch(url).then(r => r.json());
    if (!data.candles) return;
    state.compareCandles[sym] = data.candles;
    renderCompareSeries(sym);
  } catch (e) { console.error(e); }
}
function renderCompareList() {
  const el = $("#compare-list");
  el.innerHTML = state.compareSymbols.map(s => `
    <span class="compare-chip" data-symbol="${s}" style="border-color:${compareColor(s)}">
      ${s.replace(".T","")}
      <button class="x" data-rm="${s}">×</button>
    </span>`).join("");
  el.querySelectorAll(".x").forEach(b => b.addEventListener("click", e => {
    const sym = b.dataset.rm;
    state.compareSymbols = state.compareSymbols.filter(s => s !== sym);
    saveCompare();
    if (state.compareSeries[sym] && state.chart) {
      state.chart.removeSeries(state.compareSeries[sym]);
      delete state.compareSeries[sym];
    }
    delete state.compareCandles[sym];
    renderCompareList();
    e.stopPropagation();
  }));
}
function compareColor(sym) {
  const palette = ["#ff8c5c","#a78bfa","#ffc857","#7cc7ff","#ff5c7a"];
  let h = 0; for (const c of sym) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
function renderCompareSeries(sym) {
  if (!state.chart || !state.compareCandles[sym]) return;
  const candles = state.compareCandles[sym];
  if (state.compareSeries[sym]) state.chart.removeSeries(state.compareSeries[sym]);
  // 主銘柄の最初の終値を100に正規化して比較しやすくする
  const mainBase = state.candles[0]?.c;
  const subBase = candles[0]?.c;
  const useNormalize = mainBase && subBase;
  const series = state.chart.addLineSeries({
    color: compareColor(sym), lineWidth: 1.4, priceLineVisible: false, lastValueVisible: true, priceScaleId: useNormalize ? "compare" : "right",
  });
  if (useNormalize) {
    state.chart.priceScale("compare").applyOptions({ visible: false });
    series.setData(candles.map(c => ({ time: c.t, value: (c.c / subBase) * mainBase })));
  } else {
    series.setData(candles.map(c => ({ time: c.t, value: c.c })));
  }
  state.compareSeries[sym] = series;
}

// ========== ICHIMOKU 一目均衡表 ==========
function ichimoku(highs, lows, closes) {
  const n = closes.length;
  const tenkan = new Array(n).fill(null);   // 転換線 (9)
  const kijun = new Array(n).fill(null);    // 基準線 (26)
  const spanA = new Array(n).fill(null);    // 先行スパンA
  const spanB = new Array(n).fill(null);    // 先行スパンB (52)
  const chikou = new Array(n).fill(null);   // 遅行スパン
  const range = (arr, i, p) => {
    if (i < p - 1) return [null, null];
    let mx = -Infinity, mn = Infinity;
    for (let j = i - p + 1; j <= i; j++) { mx = Math.max(mx, arr[j]); mn = Math.min(mn, arr[j]); }
    return [mx, mn];
  };
  for (let i = 0; i < n; i++) {
    const [h9, l9] = (() => { const [hi,lo] = [highs,lows].map(a=>range(a,i,9)); return [hi[0],lo[1]]; })();
    if (h9 != null && l9 != null) tenkan[i] = (h9 + l9) / 2;
    const h26 = range(highs, i, 26)[0]; const l26 = range(lows, i, 26)[1];
    if (h26 != null && l26 != null) kijun[i] = (h26 + l26) / 2;
    if (tenkan[i] != null && kijun[i] != null) spanA[i] = (tenkan[i] + kijun[i]) / 2;
    const h52 = range(highs, i, 52)[0]; const l52 = range(lows, i, 52)[1];
    if (h52 != null && l52 != null) spanB[i] = (h52 + l52) / 2;
    if (i + 26 < n) chikou[i + 26] = closes[i]; // ※視覚的には遅行=現在価格を26期前にプロット、ここでは未来側へずらす近似
  }
  return { tenkan, kijun, spanA, spanB, chikou };
}

// ========== ATR ==========
function ATR(highs, lows, closes, p=14) {
  const n = closes.length;
  const tr = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = highs[i] - lows[i]; continue; }
    tr[i] = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));
  }
  const out = new Array(n).fill(null);
  let prev = null;
  for (let i = 0; i < n; i++) {
    if (i < p - 1) continue;
    if (prev == null) { let s = 0; for (let j = 0; j < p; j++) s += tr[j]; prev = s / p; }
    else prev = (prev * (p - 1) + tr[i]) / p;
    out[i] = prev;
  }
  return out;
}

// ========== Stochastic ==========
function Stochastic(highs, lows, closes, kP=14, dP=3) {
  const n = closes.length;
  const k = new Array(n).fill(null);
  for (let i = kP - 1; i < n; i++) {
    let mx = -Infinity, mn = Infinity;
    for (let j = i - kP + 1; j <= i; j++) { mx = Math.max(mx, highs[j]); mn = Math.min(mn, lows[j]); }
    k[i] = mx === mn ? 50 : ((closes[i] - mn) / (mx - mn)) * 100;
  }
  const d = SMA(k, dP);
  return { k, d };
}

// ========== VWAP ==========
function VWAP(candles) {
  let cumPV = 0, cumV = 0;
  return candles.map(c => {
    const tp = (c.h + c.l + c.c) / 3;
    cumPV += tp * (c.v || 0);
    cumV += (c.v || 0);
    return cumV ? cumPV / cumV : null;
  });
}

function renderExtraIndicators() {
  if (!state.chart || !state.candles.length) return;
  const c = chartColors();
  const highs = state.candles.map(d => d.h);
  const lows = state.candles.map(d => d.l);
  const closes = state.candles.map(d => d.c);

  ["ichTen","ichKij","ichA","ichB"].forEach(k => { if (state.series[k]) { state.chart.removeSeries(state.series[k]); state.series[k]=null; }});
  if (state.indicators.ichimoku) {
    const ic = ichimoku(highs, lows, closes);
    state.series.ichTen = state.chart.addLineSeries({ color: "#ff5c7a", lineWidth: 1, priceLineVisible:false, lastValueVisible:false });
    state.series.ichKij = state.chart.addLineSeries({ color: "#7cc7ff", lineWidth: 1, priceLineVisible:false, lastValueVisible:false });
    state.series.ichA = state.chart.addLineSeries({ color: "rgba(46,204,113,.7)", lineWidth: 1, priceLineVisible:false, lastValueVisible:false });
    state.series.ichB = state.chart.addLineSeries({ color: "rgba(255,92,122,.6)", lineWidth: 1, priceLineVisible:false, lastValueVisible:false });
    state.series.ichTen.setData(state.candles.map((d,i)=>({time:d.t,value:ic.tenkan[i]})).filter(d=>d.value!=null));
    state.series.ichKij.setData(state.candles.map((d,i)=>({time:d.t,value:ic.kijun[i]})).filter(d=>d.value!=null));
    state.series.ichA.setData(state.candles.map((d,i)=>({time:d.t,value:ic.spanA[i]})).filter(d=>d.value!=null));
    state.series.ichB.setData(state.candles.map((d,i)=>({time:d.t,value:ic.spanB[i]})).filter(d=>d.value!=null));
  }

  if (state.series.vwap) { state.chart.removeSeries(state.series.vwap); state.series.vwap = null; }
  if (state.indicators.vwap) {
    const v = VWAP(state.candles);
    state.series.vwap = state.chart.addLineSeries({ color: c.line3, lineWidth: 1.5, lineStyle: 2, priceLineVisible:false, lastValueVisible:false });
    state.series.vwap.setData(state.candles.map((d,i)=>({time:d.t,value:v[i]})).filter(d=>d.value!=null));
  }

  const sEl = $("#chart-stoch");
  if (state.indicators.stoch) {
    sEl.classList.remove("hidden");
    if (!state.stochChart) {
      state.stochChart = LightweightCharts.createChart(sEl, {
        width: sEl.clientWidth, height: sEl.clientHeight,
        layout: { background: { color: c.bg }, textColor: c.text, fontSize: 10 },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        timeScale: { borderColor: c.grid, visible: false },
        rightPriceScale: { borderColor: c.grid },
        crosshair: { mode: 1 },
      });
      state.stochChart._kabuEl = sEl;
    }
    ["stochK","stochD"].forEach(k => { if (state.series[k]) { state.stochChart.removeSeries(state.series[k]); state.series[k]=null; }});
    const st = Stochastic(highs, lows, closes, 14, 3);
    state.series.stochK = state.stochChart.addLineSeries({ color: c.line1, lineWidth: 1.5 });
    state.series.stochD = state.stochChart.addLineSeries({ color: c.line2, lineWidth: 1.5 });
    state.series.stochK.setData(state.candles.map((d,i)=>({time:d.t,value:st.k[i]})).filter(d=>d.value!=null));
    state.series.stochD.setData(state.candles.map((d,i)=>({time:d.t,value:st.d[i]})).filter(d=>d.value!=null));
    state.series.stochK.createPriceLine({ price: 80, color: c.dn, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
    state.series.stochK.createPriceLine({ price: 20, color: c.up, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
    state.stochChart.timeScale().fitContent();
  } else {
    sEl.classList.add("hidden");
    if (state.stochChart) { state.stochChart.remove(); state.stochChart = null; state.series.stochK = state.series.stochD = null; }
  }

  const aEl = $("#chart-atr");
  if (state.indicators.atr) {
    aEl.classList.remove("hidden");
    if (!state.atrChart) {
      state.atrChart = LightweightCharts.createChart(aEl, {
        width: aEl.clientWidth, height: aEl.clientHeight,
        layout: { background: { color: c.bg }, textColor: c.text, fontSize: 10 },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        timeScale: { borderColor: c.grid, visible: false },
        rightPriceScale: { borderColor: c.grid },
        crosshair: { mode: 1 },
      });
      state.atrChart._kabuEl = aEl;
    }
    if (state.series.atr) { state.atrChart.removeSeries(state.series.atr); state.series.atr = null; }
    const a = ATR(highs, lows, closes, 14);
    state.series.atr = state.atrChart.addLineSeries({ color: c.line4, lineWidth: 1.5 });
    state.series.atr.setData(state.candles.map((d,i)=>({time:d.t,value:a[i]})).filter(d=>d.value!=null));
    state.atrChart.timeScale().fitContent();
  } else {
    aEl.classList.add("hidden");
    if (state.atrChart) { state.atrChart.remove(); state.atrChart = null; state.series.atr = null; }
  }

  // 比較銘柄シリーズ復元
  state.compareSymbols.forEach(s => {
    if (state.compareCandles[s]) renderCompareSeries(s);
  });
}

// ========== ANALYST UPGRADE HISTORY ==========
function renderUpgrades() {
  const el = $("#upgrade-list");
  const ud = state.summary?.upgradeDowngradeHistory?.history || [];
  if (!ud.length) { el.innerHTML = '<div class="sc-empty">履歴データなし</div>'; return; }
  const top = ud.slice(0, 8);
  const actMap = {
    up: { cls: "act-up", text: "↑格上げ" },
    down: { cls: "act-down", text: "↓格下げ" },
    init: { cls: "act-init", text: "★新規" },
    main: { cls: "act-maint", text: "維持" },
    reit: { cls: "act-maint", text: "再表明" },
  };
  el.innerHTML = top.map(h => {
    const date = h.epochGradeDate ? new Date(h.epochGradeDate * 1000).toLocaleDateString("ja-JP", {year:'2-digit',month:'2-digit',day:'2-digit'}) : "--";
    const a = actMap[h.action] || { cls: "act-maint", text: h.action || "--" };
    const grade = h.fromGrade && h.fromGrade !== h.toGrade ? `${h.fromGrade}→${h.toGrade}` : h.toGrade;
    return `<div class="up-item">
      <span class="up-date">${date}</span>
      <span class="up-firm"><strong>${h.firm||"--"}</strong> ${grade||""}</span>
      <span class="up-action ${a.cls}">${a.text}</span>
    </div>`;
  }).join("");
}

// ========== HOLDERS ==========
function renderHolders() {
  const el = $("#holders-list");
  const m = state.summary?.majorHoldersBreakdown;
  if (!m) { el.innerHTML = '<div class="sc-empty">データなし</div>'; return; }
  const rows = [
    { label: "インサイダー保有", val: m.insidersPercentHeld?.raw },
    { label: "機関投資家保有", val: m.institutionsPercentHeld?.raw },
    { label: "上位機関比率", val: m.institutionsFloatPercentHeld?.raw },
  ].filter(r => r.val != null);
  if (!rows.length) { el.innerHTML = '<div class="sc-empty">データなし</div>'; return; }
  el.innerHTML = rows.map(r => `
    <div class="holder-bar">
      <span class="holder-name">${r.label}</span>
      <span class="holder-pct">${fmt(r.val*100,2)}%</span>
      <div class="holder-bar-bg"><div class="holder-bar-fg" style="width:${Math.min(100, r.val*100)}%"></div></div>
    </div>`).join("");
}

// ========== NOTE ==========
function loadNote() {
  if (!state.symbol) return;
  const key = `kabu_note_${state.symbol}`;
  const text = localStorage.getItem(key) || "";
  $("#note").value = text;
  const updKey = `${key}_upd`;
  const upd = localStorage.getItem(updKey);
  $("#note-meta").textContent = upd ? `更新: ${upd}` : "未保存";
}
function setupNote() {
  let saveTimer = null;
  $("#note").addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!state.symbol) return;
      const key = `kabu_note_${state.symbol}`;
      localStorage.setItem(key, $("#note").value);
      const now = new Date().toLocaleString("ja-JP");
      localStorage.setItem(`${key}_upd`, now);
      $("#note-meta").textContent = `自動保存: ${now}`;
    }, 500);
  });
}

// ========== AI SUMMARY ==========
function setupAI() {
  $("#ai-run").addEventListener("click", async () => {
    if (!state.symbol || !state.quote) return;
    const btn = $("#ai-run");
    const out = $("#ai-result");
    btn.disabled = true;
    out.innerHTML = '<div class="ai-loading"><span class="loading"></span>Geminiで要約生成中…</div>';

    const ctx = buildAIContext();
    try {
      const r = await fetch("/api/ai-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: state.symbol, context: ctx }),
      }).then(r => r.json());
      out.textContent = r.text || "(空応答)";
    } catch (e) {
      out.textContent = "エラーが発生しました: " + e;
    } finally {
      btn.disabled = false;
    }
  });
}
function buildAIContext() {
  const q = state.quote || {};
  const sd = state.summary?.summaryDetail || {};
  const fd = state.summary?.financialData || {};
  const fs = computeFScore();
  const fsScore = fs.filter(f=>f.pass===true).length;
  const fsValid = fs.filter(f=>f.pass!=null).length;
  return [
    `銘柄名: ${q.longName||q.shortName||q.symbol}`,
    `業種: ${state.summary?.assetProfile?.industryDisp||"--"}`,
    `現在値: ${q.regularMarketPrice} 円 (前日比 ${q.regularMarketChangePercent?.toFixed?.(2)}%)`,
    `時価総額: ${fmtCap(q.marketCap)}`,
    `PER: ${q.trailingPE?.toFixed?.(2)} / PBR: ${q.priceToBook?.toFixed?.(2)} / 配当利回り: ${(q.trailingAnnualDividendYield||0)*100}%`,
    `EPS: ${q.epsTrailingTwelveMonths} / BPS: ${q.bookValue}`,
    `ROE: ${(fd.returnOnEquity?.raw*100)?.toFixed?.(2)||'--'}% / ROA: ${(fd.returnOnAssets?.raw*100)?.toFixed?.(2)||'--'}%`,
    `配当性向: ${(sd.payoutRatio?.raw*100)?.toFixed?.(1)||'--'}%`,
    `アナリスト目標株価: ${fd.targetMeanPrice?.raw}円 / カバー${fd.numberOfAnalystOpinions?.raw||0}名`,
    `ピオトロスキーF-Score: ${fsScore}/${fsValid}`,
    `52週高値: ${q.fiftyTwoWeekHigh} / 安値: ${q.fiftyTwoWeekLow}`,
  ].join("\n");
}

// ========== CSV EXPORT ==========
function exportCSV() {
  if (!state.candles.length) { toast("データがありません","error"); return; }
  const rows = [["date","open","high","low","close","volume"]];
  state.candles.forEach(c => {
    const d = new Date(c.t * 1000);
    rows.push([d.toISOString().slice(0,10), c.o, c.h, c.l, c.c, c.v||""]);
  });
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${state.symbol}_${state.range}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast("CSV出力しました", "success");
}

// ========== TOAST ==========
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast toast-${kind} toast-fade`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ========== KEYBOARD ==========
function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "/" || e.key === "?") { e.preventDefault(); $("#search").focus(); return; }
    if (e.key === "Escape") {
      $("#kbd-modal").classList.add("hidden");
      $("#suggest").classList.add("hidden");
      return;
    }
    if (e.key === "w") { $("#watch-add").click(); return; }
    if (e.key === "r") { if (state.symbol) loadAll(); return; }
    if (e.key === "t") { $("#theme-toggle").click(); return; }
    if (e.key === "p") { window.print(); return; }
    if (e.key === "e") { exportCSV(); return; }
    if (e.key === "j" || e.key === "k") {
      const list = state.watchlist;
      if (!list.length) return;
      const idx = list.findIndex(w => w.symbol === state.symbol);
      const next = e.key === "j" ? Math.min(list.length-1, idx+1) : Math.max(0, idx-1);
      if (next !== idx && list[next]) selectSymbol(list[next].symbol);
      return;
    }
    if (/^[1-6]$/.test(e.key)) {
      const btn = $$(".range-btn")[parseInt(e.key)-1];
      if (btn) btn.click();
      return;
    }
  });
}

// ========== UI WIRE-UP for new buttons ==========
(function() {
  // 後付けで一度だけ実行されるよう、initロード後に呼ばれるためinit末尾で都度ガード
})();

document.addEventListener("DOMContentLoaded", () => {
  // setup hooks（init後でも呼べる）
  setTimeout(() => {
    setupCompare();
    setupAI();
    setupNote();
    setupKeyboard();
    loadCompareFromStorage();
    state.compareSymbols.forEach(s => loadCompareSymbol(s));
    renderCompareList();

    $("#export-csv")?.addEventListener("click", exportCSV);
    $("#print-page")?.addEventListener("click", () => window.print());
    $("#kbd-help")?.addEventListener("click", () => $("#kbd-modal").classList.remove("hidden"));
    $("#kbd-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "kbd-modal") $("#kbd-modal").classList.add("hidden");
    });
  }, 100);
});

// (override pattern回避：renderIndicators / loadSummary / selectSymbol / loadChart はそれぞれ
//  本体で renderExtraIndicators / renderUpgrades / renderHolders / loadNote / loadCompareSymbol を直接呼ぶ)

