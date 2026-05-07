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
  indicators: { sma5:true, sma25:true, sma75:false, sma200:false, bb:false, vol:true, rsi:false, macd:false },
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
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json()).catch(() => ({ items: [] }));
      items = r.items || [];
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
  } catch (e) { console.error("loadSummary", e); }
}

function renderEarnings() {
  const el = $("#earnings-bars");
  const meta = $("#earn-meta");
  if (!state.earningsAnnual?.length) { el.innerHTML = '<div class="sc-empty">データなし</div>'; meta.innerHTML = ""; return; }

  const m = state.earnMetric;
  let label, getter;
  if (m === "revenue") { label="売上"; getter = (e,_,__) => e.totalRevenue?.raw; }
  else if (m === "opIncome") { label="営業利益"; getter = (e,_,__) => e.operatingIncome?.raw ?? e.ebit?.raw; }
  else if (m === "netIncome") { label="純利益"; getter = (e,_,__) => e.netIncome?.raw; }
  else if (m === "eps") { label="EPS"; getter = (_,bs,__) => null; /* incomeにはEPS無し、後で個別 */ }
  else if (m === "opcf") { label="営業CF"; getter = (_,_,cf) => cf?.totalCashFromOperatingActivities?.raw; }
  else if (m === "fcf") { label="FCF"; getter = (_,_,cf) => {
      const op = cf?.totalCashFromOperatingActivities?.raw;
      const cap = cf?.capitalExpenditures?.raw;
      return (op != null && cap != null) ? op + cap : null; // capExは負値
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
