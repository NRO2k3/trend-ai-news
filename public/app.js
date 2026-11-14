'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const nf0 = new Intl.NumberFormat('vi-VN');
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const DAY = 86400e3;
const REFRESH_MS = 15 * 60e3;

const TABS = ['tong-quan', 'tin-tuc', 'repo', 'cong-nghe', 'y-tuong', 'nghien-cuu', 'ky-luc'];
const CATS = { all: 'Tất cả', lab: 'Công ty AI', dev: 'Nền tảng dev', media: 'Báo công nghệ', research: 'Kỹ thuật', community: 'Blog & diễn đàn' };
const RANGES = { 1: '24 giờ qua', 3: '3 ngày qua', 7: '7 ngày qua', 30: '30 ngày qua' };
const PROVIDERS = {
  google: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', meta: 'Meta', 'meta-llama': 'Meta', mistralai: 'Mistral',
  deepseek: 'DeepSeek', qwen: 'Alibaba (Qwen)', 'x-ai': 'xAI', moonshotai: 'Moonshot', baidu: 'Baidu', 'z-ai': 'Zhipu',
  amazon: 'Amazon', microsoft: 'Microsoft', nvidia: 'NVIDIA', cohere: 'Cohere', minimax: 'MiniMax', liquid: 'Liquid AI',
  thinkingmachines: 'Thinking Machines', inclusionai: 'Ant Group (inclusionAI)', openrouter: 'OpenRouter', bytedance: 'ByteDance',
  'bytedance-seed': 'ByteDance', tencent: 'Tencent', ibm: 'IBM', perplexity: 'Perplexity', moondream: 'Moondream',
};
const EFFORT = { low: 'suy nghĩ ít', medium: 'suy nghĩ vừa', high: 'suy nghĩ nhiều', xhigh: 'suy nghĩ rất nhiều', max: 'suy nghĩ tối đa' };

const state = { cat: 'all', days: 3, q: '', source: '', trend: null, limit: 40, lang: 'vi', repoMode: 'trending' };
const data = { news: null, models: null, papers: null, progress: null, repos: null, tools: null, tech: null, ideas: null };

// ---------- helpers ----------

function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / DAY);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

// "6,9 triệu", "12 nghìn"
function big(n) {
  if (n >= 1e6) return `${nf1.format(n / 1e6)} triệu`;
  if (n >= 1e4) return `${nf0.format(Math.round(n / 1e3))} nghìn`;
  return nf0.format(n);
}

// Vietnamese machine translation when available and wanted, otherwise the original.
const tx = (obj, field) => (state.lang === 'vi' && obj[`${field}Vi`]) || obj[field] || '';

const link = (url, text, cls = '') =>
  `<a${cls ? ` class="${cls}"` : ''} href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${text}</a>`;
const thumb = (src, cls = 'thumb') =>
  src ? `<img class="${cls}" src="${esc(safeUrl(src))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
const avatar = (owner) => `<img class="avatar" src="https://github.com/${encodeURIComponent(owner)}.png?size=64" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
const icon = (id) => `<svg class="i"><use href="#i-${id}"/></svg>`;
// Lowercase without Vietnamese accents, so "bao mat" finds "bảo mật".
const fold = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
const LANG_COLORS = {
  Python: '#3572A5', TypeScript: '#3178c6', JavaScript: '#f1e05a', Rust: '#dea584', Go: '#00ADD8', 'Jupyter Notebook': '#DA5B0B',
  Shell: '#89e051', HTML: '#e34c26', 'C++': '#f34b7d', C: '#555555', Java: '#b07219', Swift: '#F05138', Kotlin: '#A97BFF', Ruby: '#701516',
  PHP: '#4F5D95', Dart: '#00B4AB', Vue: '#41b883', Svelte: '#ff3e00', MDX: '#fcb32c', Zig: '#ec915c',
};

function setCount(name, n) {
  for (const el of $$(`[data-count="${name}"]`)) el.textContent = n ? String(n) : '';
}

const providerName = (id) => PROVIDERS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

// "claude-opus-4-7_max" → "Claude Opus 4.7"; the suffix is the reasoning effort.
function modelName(raw) {
  const words = [];
  for (const part of raw.split('_')[0].split('-')) {
    const prev = words.at(-1);
    if (/^\d+$/.test(part) && /^\d+$/.test(prev ?? '')) {
      words[words.length - 1] = `${prev}.${part}`;
    } else {
      words.push(/^(gpt|glm|llm)$/i.test(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1));
    }
  }
  return words.join(' ');
}
const effortOf = (raw) => EFFORT[raw.split('_')[1]] ?? '';

function fmtScore(kind, v) {
  if (kind === 'elo') return `${nf0.format(Math.round(v))} điểm`;
  if (kind === 'minutes') return v >= 60 ? `${nf1.format(v / 60)} giờ` : `${nf1.format(v)} phút`;
  return `${nf1.format(v * 100)}%`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

async function api(name, force) {
  // Revalidate every time: the data is rebuilt every 30 minutes under the same URL,
  // and browsers otherwise keep serving a copy that can be hours old.
  const res = await fetch(`data/${name}.json` + (force ? `?refresh=${Date.now()}` : ''), { cache: 'no-cache' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function fail(selectors, err) {
  for (const sel of selectors) {
    const el = $(sel);
    if (el) el.innerHTML = `<p class="error">Không tải được dữ liệu (${esc(err.message)}). Thử bấm “Làm mới”.</p>`;
  }
}

function setHTML(sel, html) {
  const el = $(sel);
  if (el) el.innerHTML = html;
}

// ---------- tabs ----------

function route() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tong-quan';
  for (const page of $$('.page')) page.hidden = page.dataset.page !== tab;
  for (const a of $$('a[data-tab]')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  // On phones "Thêm" stands for the sections that only live in its sheet.
  const more = $('#more-btn');
  if (more) {
    if (['cong-nghe', 'nghien-cuu', 'ky-luc'].includes(tab)) more.setAttribute('aria-current', 'page');
    else more.removeAttribute('aria-current');
  }
  closeSheet();
  // Charts are sized to their box, which has no width while the tab is hidden.
  if (tab === 'ky-luc') renderRaceCharts();
  const label = $(`.nav a[data-tab="${tab}"] span`)?.textContent;
  document.title = tab === 'tong-quan' || !label ? 'Xu hướng AI' : `${label} · Xu hướng AI`;
}

function goTab(tab) {
  if (location.hash.slice(1) !== tab) location.hash = tab;
  route();
  window.scrollTo(0, 0);
}

// Sticky header + tabs height, so the news filters stick right below them.
function measureSticky() {
  const bar = $('.topbar');
  const h = bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0;
  document.documentElement.style.setProperty('--stick', `${h}px`);
}

// ---------- overview ----------

function renderPulse() {
  const { news, models, repos, progress } = data;
  const tiles = [];
  if (news) {
    const day = news.items.filter((it) => Date.now() - Date.parse(it.date) < DAY).length;
    const ok = news.sources.filter((s) => s.ok).length;
    tiles.push({ tab: 'tin-tuc', icon: 'news', label: 'Tin mới 24 giờ qua', value: day, note: `từ ${ok} nguồn tin` });
  }
  if (repos?.trending.length) {
    const top = repos.trending[0];
    tiles.push({ tab: 'repo', icon: 'repo', label: 'Repo hot nhất tuần', value: `<span class="mono">${esc(top.name.split('/')[1])}</span>`, note: `+${nf0.format(top.week || top.today)} sao tuần này`, small: true });
  }
  if (models) {
    const lead = models.byProvider[0];
    tiles.push({ tab: 'cong-nghe', icon: 'cpu', label: 'Mô hình mới 30 ngày', value: models.last30, note: lead ? `nhiều nhất: ${esc(providerName(lead.provider))} (${lead.count})` : '' });
  }
  if (progress) {
    const latest = progress.benchmarks
      .map((b) => ({ b, r: b.record.at(-1) }))
      .sort((x, y) => Date.parse(y.r.date) - Date.parse(x.r.date))[0];
    if (latest) {
      tiles.push({ tab: 'ky-luc', icon: 'trophy', label: 'Kỷ lục mới nhất', value: esc(modelName(latest.r.model)), note: `${esc(latest.b.title)}: ${fmtScore(latest.b.kind, latest.r.score)}`, small: true });
    }
  }
  setHTML(
    '#pulse',
    tiles
      .map((t) => `<a class="kpi" href="#${t.tab}"><span class="kpi-label">${icon(t.icon)}${t.label}</span><span class="kpi-value${t.small ? ' small' : ''}">${t.value}</span><span class="kpi-note">${t.note}</span></a>`)
      .join(''),
  );
}

function renderOverviewHot() {
  const hot = data.news.hot.slice(0, 4);
  setHTML(
    '#ov-hot',
    hot.length
      ? hot
          .map((c, i) => {
            const it = c.lead;
            const sum = i === 0 ? tx(it, 'summary') : '';
            return `<a class="feature" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">
              <div>
                <div class="feature-title">${esc(tx(it, 'title'))}</div>
                ${sum ? `<p class="feature-sum">${esc(sum)}</p>` : ''}
                <div class="meta"><span class="src">${esc(it.sourceName)}</span><span class="badge">${c.sourceCount} nguồn</span><span>${ago(c.latest)}</span></div>
              </div>
              ${thumb(it.image)}
            </a>`;
          })
          .join('')
      : '<p class="empty">Chưa có tin nóng.</p>',
  );
}

function renderOverviewRepos() {
  setHTML(
    '#ov-repos',
    data.repos.trending
      .slice(0, 6)
      .map((r) => {
        const [owner, name] = r.name.split('/');
        return `<a class="row" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">
          ${avatar(owner)}
          <div class="min0"><div class="row-title mono">${esc(owner)}/<b>${esc(name)}</b></div><div class="row-sub">${esc(tx(r, 'description'))}</div></div>
          <span class="pill-up">${icon('star')}+${nf0.format(r.week || r.today)}</span>
        </a>`;
      })
      .join(''),
  );
}

function renderOverviewTech() {
  const list = data.tech.techs.slice(0, 7);
  const max = Math.max(1, ...list.map((t) => t.total));
  setHTML(
    '#ov-tech',
    list
      .map(
        (t) => `<a class="bar-row" href="#cong-nghe" title="${esc(t.what)}">
          <span class="name">${esc(t.name)}</span>
          <span class="bar-track"><span class="bar" style="display:block;width:${(t.total / max) * 100}%"></span></span>
          <span class="val">${t.total}</span>
        </a>`,
      )
      .join(''),
  );
}

function renderOverviewModels() {
  setHTML(
    '#ov-models',
    data.models.models
      .slice(0, 5)
      .map(
        (m) => `<a class="row no-lead" href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">
          <div class="min0"><div class="row-title">${esc(m.name.replace(/^[^:]+:\s*/, ''))}</div><div class="row-sub">${esc(providerName(m.provider))} · ${ago(m.created)}</div></div>
          ${m.free ? '<span class="tag">Miễn phí</span>' : ''}
        </a>`,
      )
      .join(''),
  );
}

function renderOverviewBench() {
  setHTML(
    '#ov-bench',
    data.progress.benchmarks
      .map(
        (b) => `<a class="ov-stat" href="#ky-luc">
          <div class="label">${esc(b.title)}</div>
          <div class="value">${fmtScore(b.kind, b.leader.score)}</div>
          <div class="who">${esc(modelName(b.leader.model))}</div>
        </a>`,
      )
      .join(''),
  );
}

// ---------- benchmarks ----------

const SPARK = { W: 280, H: 76, P: 5 };

function sparkGeometry(b) {
  const { W, H, P } = SPARK;
  const pts = b.record.map((r) => ({ t: Date.parse(r.date), v: r.score, r }));
  const t0 = pts[0].t;
  const t1 = Date.now();
  const log = b.kind === 'minutes';
  // Percentages sit on a fixed 0–100% axis; open-ended scores span their own range.
  const fixed = b.kind === 'pct';
  const f = (v) => (log ? Math.log10(v) : v);
  const lo = fixed ? 0 : f(pts[0].v);
  const hi = fixed ? 1 : f(Math.max(...pts.map((p) => p.v)));
  const x = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v) => H - P - ((f(v) - lo) / (hi - lo || 1)) * (H - 2 * P);
  return { pts: pts.map((p) => ({ ...p, x: x(p.t), y: y(p.v) })), xEnd: x(t1), base: H - P, top: y(fixed ? 1 : pts.at(-1).v) };
}

function sparkline(b, i) {
  const { W, H } = SPARK;
  const g = sparkGeometry(b);
  let d = `M${g.pts[0].x},${g.pts[0].y}`;
  for (const p of g.pts.slice(1)) d += `H${p.x}V${p.y}`;
  d += `H${g.xEnd}`;
  const area = `${d}V${g.base}H${g.pts[0].x}Z`;
  const dots = g.pts
    .map((p, j) => `<circle class="pt" data-j="${j}" cx="${p.x}" cy="${p.y}" r="${j === g.pts.length - 1 ? 4 : 2.5}"/>`)
    .join('');
  const label = `Kỷ lục ${b.title} tăng từ ${fmtScore(b.kind, g.pts[0].v)} lên ${fmtScore(b.kind, g.pts.at(-1).v)}`;
  return `<svg class="spark" data-i="${i}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${b.kind === 'pct' ? `<line class="grid" x1="0" x2="${W}" y1="${g.top}" y2="${g.top}"/>` : ''}
    <line class="base" x1="0" x2="${W}" y1="${g.base}" y2="${g.base}"/>
    <path class="area" d="${area}"/><path class="line" d="${d}" vector-effect="non-scaling-stroke"/>${dots}
    <rect class="hit" x="0" y="0" width="${W}" height="${H}"/>
  </svg>`;
}

function renderProgress(progress) {
  data.progress = progress;
  setHTML(
    '#bench',
    progress.benchmarks
      .map((b, i) => {
        const L = b.leader;
        let delta = '';
        if (b.yearAgo) {
          const change =
            b.kind === 'minutes'
              ? `<b>gấp ${nf1.format(L.score / b.yearAgo.score)} lần</b>`
              : b.kind === 'elo'
                ? `<b>tăng ${nf0.format(Math.round(L.score - b.yearAgo.score))} điểm</b>`
                : `<b>tăng ${nf1.format((L.score - b.yearAgo.score) * 100)} điểm</b>`;
          delta = `1 năm trước chỉ ${fmtScore(b.kind, b.yearAgo.score)} → ${change}`;
        }
        const rows = b.top
          .map(
            (t) =>
              `<tr><td>${esc(modelName(t.model))} <small>(${esc(t.org)})</small><br><small>${effortOf(t.model) ? `${effortOf(t.model)} · ` : ''}${fmtDate(t.date)}</small></td><td>${fmtScore(b.kind, t.score)}</td></tr>`,
          )
          .join('');
        return `<article class="bench">
          <h3>${esc(b.title)}</h3>
          <div class="orig">Bài kiểm tra: ${esc(b.name)}</div>
          <div class="desc">${esc(b.desc)}</div>
          <div class="big">${fmtScore(b.kind, L.score)}</div>
          <div class="caption">${esc(b.caption)}</div>
          <div class="who">Dẫn đầu: <strong>${esc(modelName(L.model))}</strong> của ${esc(L.org)}</div>
          ${delta ? `<div class="delta">${delta}</div>` : ''}
          ${sparkline(b, i)}
          <div class="axis"><span>${new Date(b.record[0].date).getFullYear()}</span><span>hiện nay</span></div>
          <details><summary>5 mô hình dẫn đầu · ${b.evaluated} mô hình đã thử ${icon('chevron')}</summary><table>${rows}</table></details>
        </article>`;
      })
      .join(''),
  );
  renderOverviewBench();
  renderPulse();
  renderRace();
}

// Crosshair-style hover: snap to the nearest record point.
function initSparkHover() {
  const tip = $('#tip');
  const host = $('#bench');
  let lastDot = null;
  const clear = () => {
    tip.hidden = true;
    lastDot?.classList.remove('on');
    lastDot = null;
  };
  host.addEventListener('mousemove', (e) => {
    const svg = e.target.closest('.spark');
    if (!svg || !data.progress) return clear();
    const b = data.progress.benchmarks[svg.dataset.i];
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SPARK.W;
    const g = sparkGeometry(b);
    let best = 0;
    g.pts.forEach((p, j) => { if (Math.abs(p.x - px) < Math.abs(g.pts[best].x - px)) best = j; });
    const p = g.pts[best];
    const dot = svg.querySelector(`.pt[data-j="${best}"]`);
    if (dot !== lastDot) { lastDot?.classList.remove('on'); dot.classList.add('on'); lastDot = dot; }
    tip.innerHTML = `Kỷ lục <b>${fmtScore(b.kind, p.v)}</b><br>${esc(modelName(p.r.model))} (${esc(p.r.org)})<br>${fmtDate(p.r.date)}`;
    tip.hidden = false;
    const tx = rect.left + (p.x / SPARK.W) * rect.width;
    const ty = rect.top + (p.y / SPARK.H) * rect.height;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, tx - tip.offsetWidth / 2))}px`;
    tip.style.top = `${ty - tip.offsetHeight - 12}px`;
  });
  host.addEventListener('mouseleave', clear);
}

// ---------- model race ----------

// Fixed colour order (validated for colour-blind readers); a lab keeps its colour in every chart.
const LABS = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'open', name: 'Mã nguồn mở' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'google', name: 'Google' },
];
const race = { bench: 'web', sort: null, dir: -1, open: false, cheap: false, all: false };
const LB_FIRST = 20;
const nfPrice = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
let valuePts = [];
let raceView = null;

const shortScore = (kind, v) => (kind === 'elo' ? nf0.format(Math.round(v)) : `${nf1.format(v * 100)}%`);
const fmtPrice = (v) => `${nfPrice.format(v < 0.1 ? +v.toFixed(3) : v)} $`;
const fmtCtx = (c) => (c >= 1e6 ? `${nf1.format(c / 1e6)}M` : `${Math.round(c / 1000)}K`);
// "DeepSeek V4.1 Flash 1017" → "DeepSeek V4.1 Flash" for chart labels.
const shortName = (name) => name.replace(/\s*\(\d{4}\)$/, '').replace(/\s+\d{4}$/, '');
const legendItem = (cls, name, line = false) => `<span class="lg"><i class="sw${line ? ' line' : ''} ${cls}"></i>${esc(name)}</span>`;

function showTip(html, x, y) {
  const tip = $('#tip');
  tip.innerHTML = html;
  tip.hidden = false;
  tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, x - tip.offsetWidth / 2))}px`;
  tip.style.top = `${Math.max(8, y - tip.offsetHeight - 14)}px`;
}
const hideTip = () => { $('#tip').hidden = true; };

// Round tick values covering [lo, hi].
function ticks(lo, hi, count) {
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function renderValueChart() {
  const host = $('#value-chart');
  const R = data.progress.race;
  const b = R.benches[race.bench];
  if (!host.clientWidth) return;
  const pts = R.models.filter((m) => m.blend && m.scores[b.key]).map((m) => ({ m, v: m.scores[b.key].v, p: m.blend }));
  if (pts.length < 3) {
    host.innerHTML = '<p class="empty">Chưa đủ model có cả điểm và giá cho bài này.</p>';
    setHTML('#value-insight', '');
    return;
  }
  // Cheapest model at each level of score: the ones worth considering.
  const front = [];
  for (const q of [...pts].sort((a, c) => a.p - c.p || c.v - a.v)) if (!front.length || q.v > front.at(-1).v) front.push(q);
  const top = front.at(-1);
  const near = front.find((q) => (b.kind === 'elo' ? q.v >= top.v - 100 : q.v >= top.v * 0.8));
  // The cheapest one still worth a look: at least half the top score, or within 300 Elo.
  const cheapest = front.find((q) => (b.kind === 'elo' ? q.v >= top.v - 300 : q.v >= top.v * 0.5));
  const times = (a, c) => `${nf0.format(Math.round(a / c))} lần`;
  const gapText = (q) => (b.kind === 'elo' ? `kém ${nf0.format(Math.round(top.v - q.v))} điểm` : `đạt ${shortScore(b.kind, q.v)} so với ${shortScore(b.kind, top.v)}`);
  const lines = [];
  if (near && near !== top) lines.push(`<b>${esc(shortName(near.m.name))}</b> ${gapText(near)} của model giỏi nhất (${esc(shortName(top.m.name))}) mà rẻ hơn ${times(top.p, near.p)}.`);
  if (cheapest && cheapest !== near && cheapest !== top) lines.push(`Rẻ hơn nữa: <b>${esc(shortName(cheapest.m.name))}</b>, ${fmtPrice(cheapest.p)} cho ${shortScore(b.kind, cheapest.v)}${b.kind === 'elo' ? ' điểm' : ''}.`);
  setHTML('#value-insight', lines.join(' '));

  const W = host.clientWidth;
  const H = Math.round(Math.max(280, Math.min(420, W * 0.48)));
  const P = { l: 46, r: 14, t: 12, b: 38 };
  const lx = (p) => Math.log10(p);
  const xs = pts.map((q) => lx(q.p));
  const x0 = Math.min(...xs) - 0.12;
  const x1 = Math.max(...xs) + 0.12;
  const vs = pts.map((q) => q.v);
  const span = Math.max(...vs) - Math.min(...vs) || 1;
  const y0 = Math.min(...vs) - span * 0.08;
  const y1 = Math.max(...vs) + span * 0.1;
  const X = (p) => P.l + ((lx(p) - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);

  let xt = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].filter((t) => lx(t) >= x0 && lx(t) <= x1);
  if (W < 520) xt = xt.filter((t) => /^(0\.0?)?1|^10?0?$/.test(String(t)));
  const yt = ticks(y0, y1, H < 320 ? 4 : 5);

  const grid = yt.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${P.l - 8}" y="${Y(t) + 4}" text-anchor="end">${shortScore(b.kind, t)}</text>`).join('');
  const xticks = xt.map((t) => `<line class="grid faint" x1="${X(t)}" x2="${X(t)}" y1="${P.t}" y2="${H - P.b}"/><text class="tick" x="${X(t)}" y="${H - P.b + 16}" text-anchor="middle">${fmtPrice(t)}</text>`).join('');
  const frontPath = `M${front.map((q) => `${X(q.p).toFixed(1)},${Y(q.v).toFixed(1)}`).join('L')}`;

  // Draw closed first so open models (fewer, cheaper) stay visible on top.
  valuePts = [...pts].sort((a, c) => a.m.open - c.m.open);
  const dots = valuePts.map((q, i) => `<circle class="dot ${q.m.open ? 's-open' : 's-closed'}" data-k="${i}" cx="${X(q.p).toFixed(1)}" cy="${Y(q.v).toFixed(1)}" r="5"/>`).join('');
  const hits = valuePts.map((q, i) => `<circle class="hit" data-k="${i}" cx="${X(q.p).toFixed(1)}" cy="${Y(q.v).toFixed(1)}" r="12"/>`).join('');

  // Name only the models on the cheapest-for-score line, skipping labels that would collide.
  const placed = [];
  const labels = [];
  for (const q of [...front].reverse()) {
    const text = shortName(q.m.name);
    const w = text.length * 6.4;
    const cx = X(q.p);
    const cy = Y(q.v);
    const right = cx + 9 + w <= W - P.r;
    const options = [
      { x: right ? cx + 9 : cx - 9, y: cy + 4, anchor: right ? 'start' : 'end' },
      { x: cx, y: cy - 11, anchor: 'middle' },
      { x: cx, y: cy + 19, anchor: 'middle' },
    ];
    for (const o of options) {
      const left = o.anchor === 'start' ? o.x : o.anchor === 'end' ? o.x - w : o.x - w / 2;
      const box = { l: left - 2, r: left + w + 2, t: o.y - 11, b: o.y + 3 };
      if (box.l < 0 || box.r > W || box.t < 0 || box.b > H - P.b) continue;
      if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) continue;
      placed.push(box);
      labels.push(`<text class="lbl" x="${o.x.toFixed(1)}" y="${o.y.toFixed(1)}" text-anchor="${o.anchor}">${esc(text)}</text>`);
      break;
    }
  }

  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ giá so với điểm ${esc(b.title)}: ${pts.length} model">
    ${grid}${xticks}
    <line class="axis-line" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>
    <text class="axis-title" x="${W - P.r}" y="${H - 4}" text-anchor="end">Giá, USD / 1 triệu token (thang log) →</text>
    <path class="front" d="${frontPath}"/>${dots}${labels.join('')}${hits}
  </svg>`;
}

function valueTip(q, b) {
  const m = q.m;
  const s = m.scores[b.key];
  return `<b>${esc(m.name)}</b><br>${esc(m.org)} · ${m.open ? 'mã nguồn mở' : 'mã nguồn đóng'}<br>
    ${esc(b.title)}: <b>${fmtScore(b.kind, s.v)}</b>${s.effort && EFFORT[s.effort] ? ` (${EFFORT[s.effort]})` : ''}<br>
    Giá: ${fmtPrice(m.priceIn)} vào · ${fmtPrice(m.priceOut)} ra`;
}

function renderRaceChart() {
  const host = $('#race-chart');
  const b = data.progress.race.benches[race.bench];
  if (!host.clientWidth) return;
  const now = Date.now();
  const series = LABS.map((l) => ({ ...l, steps: (b.series[l.id] ?? []).map((s) => ({ ...s, t: Date.parse(s.date) })) })).filter((s) => s.steps.length);
  if (!series.length) {
    host.innerHTML = '<p class="empty">Chưa có dữ liệu.</p>';
    return;
  }
  const t0 = Math.max(Math.min(...series.map((s) => s.steps[0].t)), now - 540 * DAY);
  // The record each lab held at a moment in time.
  const at = (s, t) => [...s.steps].reverse().find((x) => x.t <= t) ?? null;
  const shown = series.map((s) => ({ ...s, start: at(s, t0), inside: s.steps.filter((x) => x.t > t0) }));
  const vals = shown.flatMap((s) => [s.start?.v, ...s.inside.map((x) => x.v)]).filter((v) => v != null);
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const y0 = Math.min(...vals) - span * 0.06;
  const y1 = Math.max(...vals) + span * 0.08;

  const W = host.clientWidth;
  const H = Math.round(Math.max(240, Math.min(340, W * 0.55)));
  const P = { l: 46, r: 92, t: 12, b: 28 };
  const X = (t) => P.l + ((t - t0) / (now - t0)) * (W - P.l - P.r);
  const Y = (v) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);

  const yt = ticks(y0, y1, 4);
  const grid = yt.map((t) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="tick" x="${P.l - 8}" y="${Y(t) + 4}" text-anchor="end">${shortScore(b.kind, t)}</text>`).join('');
  const months = [];
  const d = new Date(t0);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  const every = W < 520 ? 6 : 3;
  while (d.getTime() < now) {
    if (d.getMonth() % every === 0) months.push(d.getTime());
    d.setMonth(d.getMonth() + 1);
  }
  const xt = months.map((t) => {
    const m = new Date(t);
    return `<text class="tick" x="${X(t)}" y="${H - P.b + 16}" text-anchor="middle">${m.getMonth() === 0 ? m.getFullYear() : `T${m.getMonth() + 1}`}</text>`;
  }).join('');

  const ends = [];
  const lines = shown.map((s) => {
    const first = s.start ?? s.inside[0];
    let path = `M${X(Math.max(first.t, t0)).toFixed(1)},${Y(first.v).toFixed(1)}`;
    for (const x of s.inside.filter((x) => x !== first)) path += `H${X(x.t).toFixed(1)}V${Y(x.v).toFixed(1)}`;
    path += `H${X(now).toFixed(1)}`;
    const last = s.inside.at(-1) ?? s.start;
    ends.push({ s, y: Y(last.v) });
    const pts = s.inside.map((x) => `<circle class="pt s-${s.id}" cx="${X(x.t).toFixed(1)}" cy="${Y(x.v).toFixed(1)}" r="4"/>`).join('');
    return `<path class="series s-${s.id}" d="${path}"/>${pts}`;
  }).join('');
  // Line-end names, nudged apart so they never overlap.
  ends.sort((a, c) => a.y - c.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
  const over = ends.length ? ends.at(-1).y - (H - P.b) : 0;
  if (over > 0) for (const e of ends) e.y -= over;
  const endLabels = ends.map((e) => `<text class="end-lbl" x="${X(now) + 8}" y="${(e.y + 4).toFixed(1)}">${esc(e.s.name)}</text>`).join('');

  raceView = { shown, b, X, t0, now, W, H, P };
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Điểm cao nhất theo hãng, ${esc(b.title)}">
    ${grid}${xt}
    <line class="axis-line" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>
    ${lines}${endLabels}
    <line class="cross" x1="0" x2="0" y1="${P.t}" y2="${H - P.b}" hidden/>
    <rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H - P.b}"/>
  </svg>`;
}

function raceTip(e) {
  const v = raceView;
  const svg = $('#race-chart svg');
  if (!v || !svg) return;
  const rect = svg.getBoundingClientRect();
  const px = Math.min(Math.max(e.clientX - rect.left, v.P.l), v.W - v.P.r);
  const t = v.t0 + ((px - v.P.l) / (v.W - v.P.l - v.P.r)) * (v.now - v.t0);
  const cross = svg.querySelector('.cross');
  cross.setAttribute('x1', px);
  cross.setAttribute('x2', px);
  cross.removeAttribute('hidden');
  const rows = v.shown
    .map((s) => ({ s, x: [...s.steps].reverse().find((x) => x.t <= t) }))
    .filter((r) => r.x)
    .sort((a, c) => c.x.v - a.x.v)
    .map((r) => `<span class="tip-row"><i class="sw s-${r.s.id}"></i>${esc(r.s.name)}: <b>${shortScore(v.b.kind, r.x.v)}</b> · ${esc(shortName(r.x.model))}</span>`)
    .join('');
  showTip(`${new Date(t).toLocaleDateString('vi-VN', { month: 'numeric', year: 'numeric' })}<br>${rows || 'Chưa có model nào được chấm'}`, rect.left + px, e.clientY);
}

function renderGap() {
  const b = data.progress.race.benches[race.bench];
  const g = b.gap;
  if (!g.open || !g.closed) {
    setHTML('#gap', '<p class="empty">Chưa đủ dữ liệu để so sánh.</p>');
    return;
  }
  const diff = g.closed.v - g.open.v;
  const diffText = b.kind === 'elo' ? `${nf0.format(Math.round(diff))} điểm` : `${nf1.format(diff * 100)} điểm %`;
  let lag = '';
  if (g.lagDays === 0) lag = `Lúc ra mắt (${fmtDate(g.open.date)}), ${esc(g.open.name)} ngang model đóng tốt nhất khi đó; model đóng vượt lên sau.`;
  else if (g.lagDays != null && g.caughtUpBy) {
    const months = Math.round(g.lagDays / 30);
    lag = `Lúc ra mắt, ${esc(g.open.name)} chỉ bằng <b>${esc(g.caughtUpBy.name)}</b> ra từ ${fmtDate(g.caughtUpBy.date)}: mã nguồn mở đi sau khoảng <b>${months ? `${months} tháng` : 'vài tuần'}</b>.`;
  }
  const stale = b.latest && Date.now() - Date.parse(b.latest) > 120 * DAY
    ? `<p class="stale">${icon('clock')}Bài này chưa chấm model nào mới từ ${fmtDate(b.latest)}, nên số liệu có thể đã cũ.</p>`
    : '';
  const row = (label, x, cls) => `<div class="gap-row"><span class="gap-label"><i class="sw ${cls}"></i>${label}</span><span class="gap-model">${esc(x.name)}<small>${esc(x.org)} · ${fmtDate(x.date)}</small></span><b>${shortScore(b.kind, x.v)}</b></div>`;
  setHTML(
    '#gap',
    `<div class="gap-hero">${diff > 0 ? diffText : 'Ngang nhau'}</div>
    <div class="gap-sub">${diff > 0 ? 'mã nguồn mở tốt nhất kém mã nguồn đóng tốt nhất' : 'mã nguồn mở đã bắt kịp'}</div>
    <div class="gap-rows">${row('Đóng tốt nhất', g.closed, 's-closed')}${row('Mở tốt nhất', g.open, 's-open')}</div>
    ${lag ? `<p class="gap-lag">${lag}</p>` : ''}
    ${stale}
    <button class="btn" type="button" id="gap-open">Xem các model mã nguồn mở ${icon('arrow')}</button>`,
  );
}

const LB_COLS = [
  { key: 'web', label: 'Làm web' },
  { key: 'code', label: 'Lập trình' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'price', label: 'Giá vào / ra', dir: 1 },
  { key: 'context', label: 'Ngữ cảnh' },
  { key: 'date', label: 'Ra mắt' },
];

function lbValue(m, key) {
  if (key === 'price') return m.blend;
  if (key === 'context') return m.context ?? null;
  if (key === 'date') return Date.parse(m.date);
  return m.scores[key]?.v ?? null;
}

function renderLeaderboard() {
  const R = data.progress.race;
  const key = race.sort ?? race.bench;
  const rows = R.models
    .filter((m) => (!race.open || m.open) && (!race.cheap || (m.blend != null && m.blend < 1)))
    .map((m) => ({ m, v: lbValue(m, key) }))
    // Models without a value for the sorted column always sink to the bottom.
    .sort((a, c) => (a.v == null) - (c.v == null) || (a.v - c.v) * race.dir);
  const list = race.all ? rows : rows.slice(0, LB_FIRST);
  const head = LB_COLS.map((c) => {
    const sort = c.key === key ? (race.dir < 0 ? 'descending' : 'ascending') : 'none';
    const arrow = sort === 'none' ? '' : sort === 'descending' ? ' ↓' : ' ↑';
    return `<th class="num" aria-sort="${sort}"><button type="button" data-sort="${c.key}">${c.label}${arrow}</button></th>`;
  }).join('');
  const body = list
    .map(({ m }, i) => {
      const score = (k) => {
        const s = m.scores[k];
        return `<td class="num${k === key ? ' on' : ''}">${s ? shortScore(R.benches[k].kind, s.v) : '<span class="none">–</span>'}</td>`;
      };
      const name = m.url ? link(m.url, esc(m.name)) : esc(m.name);
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td class="model">${name}<small>${esc(m.org)}${m.open ? ' · <span class="open-tag"><i class="sw s-open"></i>mở</span>' : ''}</small></td>
        ${score('web')}${score('code')}${score('terminal')}
        <td class="num${key === 'price' ? ' on' : ''}">${m.blend != null ? `${nfPrice.format(m.priceIn)} / ${nfPrice.format(m.priceOut)} $` : '<span class="none">chưa có giá</span>'}</td>
        <td class="num${key === 'context' ? ' on' : ''}">${m.context ? fmtCtx(m.context) : '<span class="none">–</span>'}</td>
        <td class="num${key === 'date' ? ' on' : ''}">${fmtDate(m.date)}</td>
      </tr>`;
    })
    .join('');
  setHTML(
    '#leaderboard',
    rows.length
      ? `<table class="lb"><thead><tr><th class="rank">#</th><th class="model">Model</th>${head}</tr></thead><tbody>${body}</tbody></table>
        ${rows.length > LB_FIRST ? `<button class="linkbtn lb-more" type="button" id="lb-all">${race.all ? 'Thu gọn' : `Xem tất cả ${rows.length} model`}</button>` : ''}`
      : '<p class="empty">Không có model nào khớp bộ lọc.</p>',
  );
}

function renderRaceCharts() {
  if (!data.progress?.race) return;
  renderValueChart();
  renderRaceChart();
}

function renderRace() {
  const R = data.progress?.race;
  if (!R) {
    for (const sel of ['#value-chart', '#race-chart', '#gap', '#leaderboard']) setHTML(sel, '<p class="empty">Chưa có dữ liệu cuộc đua, thử bấm “Làm mới”.</p>');
    return;
  }
  for (const btn of $$('#race-bench [data-bench]')) btn.setAttribute('aria-pressed', btn.dataset.bench === race.bench);
  const b = R.benches[race.bench];
  const about = data.progress.benchmarks.find((x) => x.name === b.name);
  setHTML('#race-about', `<b>${esc(b.title)}</b> (${esc(b.name)}): ${esc(about?.desc ?? '')} ${b.tested} model đã được chấm, mới nhất ngày ${fmtDate(b.latest)}.`);
  setHTML('#value-legend', legendItem('s-closed', 'Mã nguồn đóng') + legendItem('s-open', 'Mã nguồn mở'));
  setHTML('#race-legend', LABS.filter((l) => b.series[l.id]?.length).map((l) => legendItem(`s-${l.id}`, l.name, true)).join(''));
  renderRaceCharts();
  renderGap();
  renderLeaderboard();
}

function initRace() {
  $('#race-bench').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-bench]');
    if (!btn || !data.progress?.race) return;
    Object.assign(race, { bench: btn.dataset.bench, sort: null, dir: -1 });
    renderRace();
  });
  const chart = $('#value-chart');
  const valueHover = (e) => {
    const hit = e.target.closest('.hit');
    for (const d of chart.querySelectorAll('.dot.on')) d.classList.remove('on');
    if (!hit) return hideTip();
    const q = valuePts[hit.dataset.k];
    chart.querySelector(`.dot[data-k="${hit.dataset.k}"]`)?.classList.add('on');
    const r = hit.getBoundingClientRect();
    showTip(valueTip(q, data.progress.race.benches[race.bench]), r.left + r.width / 2, r.top + 6);
  };
  chart.addEventListener('pointermove', valueHover);
  chart.addEventListener('click', valueHover);
  chart.addEventListener('pointerleave', () => { hideTip(); for (const d of chart.querySelectorAll('.dot.on')) d.classList.remove('on'); });
  const rc = $('#race-chart');
  rc.addEventListener('pointermove', (e) => (e.target.closest('.hit') ? raceTip(e) : hideTip()));
  rc.addEventListener('pointerleave', () => { hideTip(); rc.querySelector('.cross')?.setAttribute('hidden', ''); });

  $('#leaderboard').addEventListener('click', (e) => {
    if (!data.progress?.race) return;
    const th = e.target.closest('[data-sort]');
    if (th) {
      const col = LB_COLS.find((c) => c.key === th.dataset.sort);
      const current = race.sort ?? race.bench;
      race.dir = current === col.key ? -race.dir : col.dir ?? -1;
      race.sort = col.key;
      renderLeaderboard();
    } else if (e.target.id === 'lb-all') {
      race.all = !race.all;
      renderLeaderboard();
    }
  });
  for (const [id, field] of [['#lb-open', 'open'], ['#lb-cheap', 'cheap']]) {
    $(id).addEventListener('change', (e) => {
      race[field] = e.target.checked;
      if (data.progress?.race) renderLeaderboard();
    });
  }
  $('#gap').addEventListener('click', (e) => {
    if (!e.target.closest('#gap-open')) return;
    race.open = true;
    $('#lb-open').checked = true;
    renderLeaderboard();
    $('.race-table').scrollIntoView({ block: 'start' });
  });
  let frame = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderRaceCharts);
  });
}

// ---------- news ----------

// "TechCrunch" → "TC", "Vercel" → "Ve": a compact stand-in for the source's logo.
function initials(name) {
  const caps = name.match(/[A-Z]/g) ?? [];
  return caps.length >= 2 ? caps.slice(0, 2).join('') : name.slice(0, 2);
}

function metaRow(it, extra = '') {
  return `<div class="meta"><span class="src">${esc(it.sourceName)}</span><span class="sep"></span><time datetime="${it.date}" title="${new Date(it.date).toLocaleString('vi-VN')}">${ago(it.date)}</time>${extra}</div>`;
}

// The busiest stories first; the rest wait behind a button so the latest news stays close.
const HOT_FIRST = 3;
let showAllHot = false;

function renderHot() {
  const news = data.news;
  if (!news.hot.length) {
    setHTML('#hot', '<p class="empty">Chưa có sự kiện nào được nhiều báo cùng đưa trong vài ngày qua.</p>');
    return;
  }
  const rest = news.hot.length - HOT_FIRST;
  setHTML(
    '#hot',
    news.hot
      .slice(0, showAllHot ? undefined : HOT_FIRST)
      .map((c) => {
        const it = c.lead;
        const related = c.related
          .slice(0, 6)
          .map((r) => `<li><b>${esc(r.sourceName)}:</b> ${link(r.url, esc(tx(r, 'title')))}</li>`)
          .join('');
        const summary = tx(it, 'summary');
        return `<article class="hot">
          <div class="min0">
            <div class="meta"><span class="dot cat-${it.cat}"></span><span class="src">${esc(it.sourceName)}</span><span class="sep"></span><span>${ago(it.date)}</span><span class="badge">${c.sourceCount} nguồn cùng đưa</span></div>
            ${link(it.url, esc(tx(it, 'title')), 'title')}
            ${summary ? `<p class="sum">${esc(summary)}</p>` : ''}
            ${related ? `<details class="related"><summary>Các nguồn khác viết gì ${icon('chevron')}</summary><ul>${related}</ul></details>` : ''}
          </div>
          ${thumb(it.image)}
        </article>`;
      })
      .join('') +
      (rest > 0 ? `<button class="btn wide" type="button" id="toggle-hot">${showAllHot ? 'Thu gọn' : `Xem thêm ${rest} sự kiện nhiều báo cùng đưa`}</button>` : ''),
  );
}

function filteredItems() {
  const items = data.news?.items ?? [];
  const cutoff = Date.now() - state.days * DAY;
  const q = state.q.trim().toLowerCase();
  const re = state.trend ? new RegExp(state.trend.pattern, 'i') : null;
  return items.filter(
    (it) =>
      (state.cat === 'all' || it.cat === state.cat) &&
      (!state.source || it.source === state.source) &&
      Date.parse(it.date) >= cutoff &&
      (!re || re.test(`${it.title} ${it.summary}`)) &&
      (!q || `${it.title} ${it.summary} ${it.titleVi ?? ''} ${it.summaryVi ?? ''} ${it.sourceName}`.toLowerCase().includes(q)),
  );
}

function renderChips() {
  const items = data.news?.items ?? [];
  const cutoff = Date.now() - state.days * DAY;
  const counts = { all: 0 };
  for (const it of items) {
    if (Date.parse(it.date) < cutoff) continue;
    counts.all++;
    counts[it.cat] = (counts[it.cat] ?? 0) + 1;
  }
  setHTML(
    '#cats',
    Object.entries(CATS)
      .map(
        ([k, label]) =>
          `<button class="chip" type="button" data-cat="${k}" aria-pressed="${state.cat === k}">${k !== 'all' ? `<span class="dot cat-${k}"></span>` : ''}${label}<span class="n">${counts[k] ?? 0}</span></button>`,
      )
      .join(''),
  );
}

function renderRiver() {
  if (!data.news) return;
  renderChips();
  const list = filteredItems();
  setHTML(
    '#active-filter',
    state.trend ? `Đang xem tin về: <strong>${esc(state.trend.name)}</strong> <button type="button" id="clear-trend">Bỏ lọc</button>` : '',
  );
  if (!list.length) {
    setHTML('#river', '<p class="empty">Không có tin nào khớp. Thử chọn khoảng thời gian dài hơn hoặc bỏ bớt điều kiện lọc.</p>');
    $('#more').hidden = true;
    return;
  }
  let lastDay = '';
  setHTML(
    '#river',
    list
      .slice(0, state.limit)
      .map((it) => {
        const day = dayLabel(it.date);
        const head = day !== lastDay ? `<h3 class="day">${day}</h3>` : '';
        lastDay = day;
        const summary = tx(it, 'summary');
        return `${head}<article class="item">
          <span class="src-badge" style="background:var(--cat-${it.cat})" title="${esc(it.sourceName)}">${esc(initials(it.sourceName))}</span>
          <div class="min0">
            ${link(it.url, esc(tx(it, 'title')), 'title')}
            ${summary ? `<p class="sum">${esc(summary)}</p>` : ''}
            ${metaRow(it)}
          </div>
          ${thumb(it.image)}
        </article>`;
      })
      .join(''),
  );
  $('#more').hidden = list.length <= state.limit;
  $('#more').textContent = `Xem thêm (còn ${list.length - state.limit} tin)`;
}

function renderTrends() {
  const news = data.news;
  const groups = [
    ['org', 'Công ty'],
    ['topic', 'Chủ đề'],
  ];
  const max = Math.max(1, ...news.trends.map((t) => t.now));
  setHTML(
    '#trends',
    groups
      .map(([kind, title]) => {
        const rows = news.trends
          .filter((t) => t.kind === kind && (t.now || t.before))
          .slice(0, 8)
          .map((t) => {
            const diff = t.now - t.before;
            const delta = diff > 0 ? `<small class="up">▲${diff}</small>` : diff < 0 ? `<small class="down">▼${-diff}</small>` : '<small>=</small>';
            return `<button class="trend" type="button" data-trend="${esc(t.name)}" title="${t.now} bài tuần này, ${t.before} bài tuần trước. Bấm để xem các tin này.">
              <span class="name">${esc(t.name)}</span>
              <span class="bar-track"><span class="bar" style="display:block;width:${(t.now / max) * 100}%"></span></span>
              <span class="val">${t.now} ${delta}</span>
            </button>`;
          })
          .join('');
        return rows ? `<div class="trend-group">${title}</div>${rows}` : '';
      })
      .join(''),
  );
}

function renderSources() {
  const news = data.news;
  const sel = $('#source');
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Mọi nguồn</option>' +
    news.sources.filter((s) => s.ok).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = current;
  setHTML(
    '#sources',
    `<ul class="src-list">${news.sources
      .map(
        (s) =>
          `<li><span class="dot cat-${s.cat}" title="${CATS[s.cat]}"></span>${esc(s.name)}<span class="n ${s.ok ? '' : 'bad'}" title="${esc(s.error ?? '')}">${s.ok ? `${s.count} tin` : 'lỗi'}</span></li>`,
      )
      .join('')}</ul>`,
  );
}

// On a static host the data is only as fresh as the last scheduled build, so say how old it is.
function renderUpdated() {
  const text = `Cập nhật ${ago(data.news.generatedAt)}`;
  const el = $('#updated');
  if (el) {
    el.textContent = text;
    el.title = new Date(data.news.generatedAt).toLocaleString('vi-VN');
  }
  setHTML('#updated-mobile', esc(text));
}

function renderNews(news) {
  data.news = news;
  setCount('news', news.items.filter((it) => Date.now() - Date.parse(it.date) < DAY).length);
  renderUpdated();
  renderHot();
  renderTrends();
  renderSources();
  renderRiver();
  renderOverviewHot();
  renderPulse();
}

// ---------- repos ----------

function renderRepos(repos) {
  data.repos = repos;
  setCount('repos', repos.trending.length);
  const rising = state.repoMode === 'rising';
  const list = rising ? repos.rising : repos.trending;
  for (const b of $$('#repo-mode button')) b.setAttribute('aria-pressed', b.dataset.mode === state.repoMode);
  setHTML(
    '#repo-hint',
    rising
      ? 'Repo AI được tạo trong 30 ngày qua, xếp theo tổng số sao.'
      : 'Repo AI trên <a href="https://github.com/trending?since=weekly" target="_blank" rel="noopener">GitHub Trending</a>, xếp theo số sao tăng thêm trong tuần.',
  );
  if (!list.length) {
    setHTML('#repos', `<p class="empty">${rising && repos.risingError ? 'Chưa lấy được danh sách repo mới (GitHub giới hạn lượt truy cập). Lần cập nhật sau sẽ có.' : 'Chưa có dữ liệu.'}</p>`);
  } else {
    setHTML(
      '#repos',
      list
        .map((r, i) => {
          const [owner, name] = r.name.split('/');
          const topics = (r.topics ?? []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
          const lang = r.language ? `<span><span class="lang-dot" style="background:${LANG_COLORS[r.language] ?? 'var(--muted)'}"></span> ${esc(r.language)}</span>` : '';
          return `<article class="repo">
            <div class="rank">${i + 1}</div>
            ${avatar(owner)}
            <div class="min0">
              ${link(r.url, `${esc(owner)}/<b>${esc(name)}</b>`, 'repo-name')}
              ${r.description ? `<p>${esc(tx(r, 'description'))}</p>` : ''}
              <div class="meta">${lang}${rising ? `<span>tạo ${ago(r.created)}</span>` : ''}${topics}</div>
            </div>
            <div class="repo-side">
              ${rising ? '' : `<span class="pill-up" title="Sao tăng thêm ${r.week ? 'tuần này' : 'hôm nay'}">${icon('trend')}+${nf0.format(r.week || r.today)}</span>`}
              <span class="stars" title="Tổng số sao">${icon('star')}${big(r.stars)}</span>
            </div>
          </article>`;
        })
        .join(''),
    );
  }
  renderOverviewRepos();
  renderPulse();
}

// ---------- tech & tools ----------

function renderTech(tech) {
  data.tech = tech;
  const max = Math.max(1, ...tech.techs.map((t) => t.total));
  setHTML(
    '#tech',
    tech.techs
      .map((t, i) => {
        const parts = [
          t.repos ? `${t.repos} repo hot` : '',
          t.news ? `${t.news} bài báo` : '',
          t.hf ? `${t.hf} mô hình/ứng dụng` : '',
        ].filter(Boolean);
        const examples = t.examples.map((e) => link(e.url, esc(e.name))).join(', ');
        const headline = t.headline ? `<div class="tech-news">${link(t.headline.url, esc(tx(t.headline, 'title')))} <span class="muted">— ${esc(t.headline.source)}</span></div>` : '';
        return `<article class="tech${i < 3 ? ' top' : ''}">
          <div class="tech-head"><h3>${esc(t.name)}</h3><span class="tech-count">${t.total}</span></div>
          <div class="tech-bar"><span style="width:${(t.total / max) * 100}%"></span></div>
          <p>${esc(t.what)}</p>
          <div class="meta">${parts.join(' · ')}</div>
          ${examples ? `<div class="tech-ex">Ví dụ: ${examples}</div>` : ''}
          ${headline}
        </article>`;
      })
      .join(''),
  );
  renderOverviewTech();
}

let showAllModels = false;

function renderModels(models) {
  data.models = models;
  setHTML('#models-sub', `${models.last30} mô hình mới trong 30 ngày qua · theo <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter</a>`);
  const list = showAllModels ? models.models : models.models.slice(0, 8);
  setHTML(
    '#models',
    `<div class="providers"><span class="muted">Hãng ra nhiều nhất:</span>${models.byProvider
      .slice(0, 6)
      .map((p) => `<span class="tag">${esc(providerName(p.provider))} ${p.count}</span>`)
      .join('')}</div>` +
      list
        .map((m) => {
          const desc = tx(m, 'description');
          return `<div class="mini">
            ${link(m.url, esc(m.name.replace(/^[^:]+:\s*/, '')), 'name')}
            <div class="meta"><span class="src">${esc(providerName(m.provider))}</span><span class="sep"></span><span>ra mắt ${ago(m.created)}</span>${m.free ? '<span class="tag">Miễn phí</span>' : ''}</div>
            ${desc ? `<p>${esc(desc)}</p>` : ''}
          </div>`;
        })
        .join('') +
      (models.models.length > 8 ? `<button class="linkbtn" type="button" id="toggle-models">${showAllModels ? 'Thu gọn' : `Xem tất cả ${models.models.length} mô hình (60 ngày qua)`}</button>` : ''),
  );
  renderOverviewModels();
  renderPulse();
}

function renderTools(tools) {
  data.tools = tools;
  setHTML(
    '#hf-models',
    tools.models
      .slice(0, 12)
      .map(
        (m) => `<div class="mini">
          ${link(m.url, esc(m.id.split('/')[1]), 'name mono')}
          <div class="meta"><span class="src">${esc(m.author)}</span>${m.taskVi ? `<span class="tag">${esc(m.taskVi)}</span>` : ''}</div>
          <div class="meta"><span>${big(m.likes)} lượt thích</span><span class="sep"></span><span>${big(m.downloads)} lượt tải</span></div>
        </div>`,
      )
      .join(''),
  );
  setHTML(
    '#hf-spaces',
    tools.spaces
      .slice(0, 12)
      .map((s) => {
        const desc = tx(s, 'description');
        return `<div class="mini">
          ${link(s.url, `${s.emoji ? `${esc(s.emoji)} ` : ''}${esc(s.title)}`, 'name')}
          <div class="meta"><span class="src">${esc(s.author)}</span><span class="sep"></span><span>${big(s.likes)} lượt thích</span></div>
          ${desc ? `<p>${esc(desc)}</p>` : ''}
        </div>`;
      })
      .join(''),
  );
}

// ---------- papers ----------

function renderPapers(res) {
  data.papers = res;
  setHTML(
    '#papers',
    res.papers.length
      ? res.papers
          .slice(0, 24)
          .map((p) => {
            const summary = tx(p, 'summary');
            return `<article class="paper">
              <div class="votes" title="Lượt thích">${p.upvotes}<small>thích</small></div>
              <div class="min0">
                ${link(p.url, esc(tx(p, 'title')), 'name')}
                ${summary ? `<p>${esc(summary)}</p>` : ''}
                <div class="meta">${p.org ? `<span class="src">${esc(p.org)}</span><span class="sep"></span>` : ''}<span>${ago(p.date)}</span></div>
              </div>
            </article>`;
          })
          .join('')
      : '<p class="empty">Hôm nay chưa có paper nào về làm phần mềm.</p>',
  );
}

// ---------- ideas ----------

const KINDS = { repo: 'Repo hot', paper: 'Nghiên cứu', space: 'Ứng dụng', model: 'Mô hình', news: 'Tin tức' };
const KIND_RANK = { repo: 0, model: 1, space: 2, paper: 3 };
// "Is this idea worth building?" — scored 1–5 each by the reader.
const CRITERIA = [
  { id: 'pain', name: 'Nỗi đau thật', q: 'Người gặp có khổ vì việc này hằng tuần không, hay chỉ “có thì tốt”?' },
  { id: 'many', name: 'Nhiều người cần', q: 'Bao nhiêu người, doanh nghiệp gặp? Lời giải có dùng lại được cho các bài toán liên kết không?' },
  { id: 'now', name: 'Vì sao là bây giờ', q: 'Công nghệ mới đủ tốt, đủ rẻ trong 1–2 năm gần đây chưa? Trước đây vì sao chưa ai làm được?' },
  { id: 'can', name: 'Mình làm được', q: 'Làm được bản thử trong 2–4 tuần với nguyên liệu có sẵn không?' },
  { id: 'pay', name: 'Có người trả tiền', q: 'Ai trả tiền, hoặc ai được lợi rõ đến mức dùng ngay?' },
  { id: 'edge', name: 'Lợi thế của mình', q: 'Bạn có gì công ty lớn không có: dữ liệu, hiểu người Việt, quan hệ trong ngành…?' },
];
// Questions that push a first idea further (SCAMPER and friends).
const PROMPTS = [
  'Bỏ bớt: bước nào trong cách làm hiện nay có thể bỏ hẳn, thay vì chỉ làm nhanh hơn?',
  'Đảo ngược: nếu người dùng không phải mở app nào cả thì sản phẩm trông thế nào?',
  'Thu nhỏ: phiên bản nhỏ nhất làm được trong một cuối tuần là gì?',
  'Phóng to: có 1 triệu người dùng thì dữ liệu thu được mở ra sản phẩm gì tiếp theo?',
  'Đổi người dùng: ai khác cũng gặp đúng nỗi đau này nhưng sẵn sàng trả tiền hơn?',
  'Kết hợp: gộp thêm một bài toán liên kết vào cùng sản phẩm có làm nó mạnh hơn không?',
  'Rủi ro: nếu AI sai một lần thì hậu quả là gì, và ai kiểm tra lại?',
  'Dữ liệu: dữ liệu để làm thử lấy ở đâu? Ai đang giữ mà chưa dùng tới?',
  'Vì sao chưa ai làm: rào cản thật sự là công nghệ, luật, hay thói quen?',
  'Chỗ đứng: chạy trong IDE, CLI, trình duyệt hay CI? Dev đang mở sẵn cái nào cả ngày?',
  'Mã nguồn mở trước để có người dùng, rồi bán bản cho đội và doanh nghiệp (tự cài, đăng nhập SSO, hỗ trợ)?',
  'Đo được không: tiết kiệm bao nhiêu giờ dev mỗi tuần? Con số đó là lý do để sếp trả tiền.',
  'Làm thành MCP server hoặc skill cho Claude Code, Cursor dùng, thay vì một app riêng?',
];

const idea = { problem: null, techs: [], scores: {}, note: '', entryId: null };
let myProblems = [];
let problemQuery = '';
let book = [];

function stored(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? []; } catch { return []; }
}

function hashStr(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// Problems saved by an earlier version may use bottlenecks that no longer exist.
const allProblems = () => [...(data.ideas?.problems ?? []), ...myProblems.filter((p) => p.nodes.some((n) => nodeOf(n)))];
const problemOf = (id) => allProblems().find((p) => p.id === id);
const techOf = (id) => data.ideas.techs.find((t) => t.id === id);
const nodeOf = (id) => data.ideas.nodes.find((n) => n.id === id);
// Technologies that ease at least one of the problem's bottlenecks.
const easing = (p) => new Set(p.nodes.flatMap((n) => nodeOf(n)?.techs ?? []));
const kindTag = (k) => `<span class="kind"><span class="dot k-${k}"></span>${KINDS[k]}</span>`;

function ideaQuestion(p, techIds) {
  const cans = techIds.map((id) => techOf(id)?.can).filter(Boolean);
  const how = cans.length > 1 ? `${cans[0]}, kết hợp ${cans[1]},` : cans[0];
  return `Dùng ${how} để ${p.goal || `giải bài toán “${p.title}”`}?`;
}

// Everything the idea card and the scorecard say about the current pick.
function ideaParts() {
  const p = problemOf(idea.problem);
  if (!p || !idea.techs.length) return null;
  const techs = idea.techs.map(techOf).filter(Boolean);
  const solved = p.nodes.filter((n) => nodeOf(n)?.techs.some((t) => idea.techs.includes(t)));
  const linked = allProblems()
    .filter((q) => q.id !== p.id)
    .map((q) => ({ q, shared: q.nodes.filter((n) => solved.includes(n)) }))
    .filter((x) => x.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length);
  return { p, techs, solved, linked, question: ideaQuestion(p, idea.techs) };
}

function verdict(scores) {
  const done = CRITERIA.filter((c) => scores[c.id]);
  if (done.length < CRITERIA.length) {
    return { total: null, cls: '', label: '', text: `Chấm đủ ${CRITERIA.length} câu để xem kết luận (đã chấm ${done.length}/${CRITERIA.length}).` };
  }
  const total = CRITERIA.reduce((s, c) => s + scores[c.id], 0);
  const weakest = CRITERIA.reduce((a, c) => (scores[c.id] < scores[a.id] ? c : a));
  const tail = scores[weakest.id] <= 2 ? ` Điểm yếu nhất: <b>${weakest.name}</b> — kiểm chứng điều này trước tiên.` : '';
  if (total >= 24) return { total, cls: 'good', label: 'Rất đáng thử', text: `<b>✓ ${total}/30 · Rất đáng thử.</b> Làm bản thử nhỏ và đưa cho 5 người dùng thật ngay.${tail}` };
  if (total >= 18) return { total, cls: 'warn', label: 'Có triển vọng', text: `<b>! ${total}/30 · Có triển vọng.</b> Hỏi chuyện 5 người đang gặp bài toán trước khi viết code.${tail}` };
  return { total, cls: 'bad', label: 'Chưa chín', text: `<b>✕ ${total}/30 · Chưa chín.</b> Thử đổi công nghệ, hoặc chuyển sang một bài toán liên kết.${tail}` };
}

function sparkCard(s, i, compact = false) {
  const it = data.ideas.items[s.item];
  const p = problemOf(s.problem);
  if (!it || !p) return '';
  const q = ideaQuestion(p, [s.tech]);
  if (compact) {
    return `<a class="ov-spark" href="#y-tuong" data-spark="${i}">
      <div class="ov-spark-q">${esc(q)}</div>
      <div class="meta">${kindTag(it.k)}<span class="ov-spark-src">${esc(tx(it, 'title'))}</span></div>
    </a>`;
  }
  const desc = tx(it, 'desc');
  const surprise = s.strong ? '' : '<span class="tag surprise" title="Ghép cố ý với một bài toán ở xa để ra ý tưởng lạ">Bất ngờ</span>';
  return `<article class="spark-card">
    <div class="meta">${kindTag(it.k)}<span class="sep"></span><span>${esc(it.note)}</span>${surprise}</div>
    ${link(it.url, esc(tx(it, 'title')), it.k === 'repo' ? 'spark-src' : 'spark-src plain')}
    ${desc ? `<p class="spark-desc">${esc(desc)}</p>` : ''}
    <div class="spark-for"><span>Bài toán</span>${esc(p.title)}</div>
    <p class="spark-q">${esc(q)}</p>
    <button class="btn spark-go" type="button" data-spark="${i}">Phát triển ý tưởng này ${icon('arrow')}</button>
  </article>`;
}

function renderSparks() {
  const { sparks } = data.ideas;
  setHTML('#sparks', sparks.length ? sparks.map((s, i) => sparkCard(s, i)).join('') : '<p class="empty">Hôm nay chưa ghép được tia lửa nào.</p>');
  setHTML('#ov-sparks', sparks.length ? sparks.slice(0, 3).map((s, i) => sparkCard(s, i, true)).join('') : '<p class="empty">Hôm nay chưa ghép được tia lửa nào.</p>');
}

function byArea(list) {
  const groups = new Map();
  for (const p of list) {
    const area = p.mine ? 'Của bạn' : p.area;
    groups.set(area, [...(groups.get(area) ?? []), p]);
  }
  return groups;
}

function renderProblemPicker() {
  const q = fold(problemQuery.trim());
  const list = allProblems().filter((p) => !q || fold(`${p.title} ${p.area} ${p.who ?? ''}`).includes(q));
  const groups = byArea(list);
  // Phones get a native dropdown instead of the long list.
  $('#problem-select').innerHTML =
    `<option value="">Chọn một bài toán…</option>` +
    [...byArea(allProblems())]
      .map(([area, ps]) => `<optgroup label="${esc(area)}">${ps.map((p) => `<option value="${esc(p.id)}"${idea.problem === p.id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</optgroup>`)
      .join('');
  setHTML(
    '#problem-picker',
    list.length
      ? [...groups]
          .map(([area, ps]) => `<div class="pick-area">${esc(area)}</div>${ps.map((p) => `<button type="button" class="pick" data-problem="${esc(p.id)}" aria-pressed="${idea.problem === p.id}">${esc(p.title)}</button>`).join('')}`)
          .join('')
      : '<p class="hint">Không có bài toán nào khớp.</p>',
  );
}

function renderTechPicker() {
  const techs = [...data.ideas.techs].sort((a, b) => b.total - a.total);
  const p = problemOf(idea.problem);
  const chip = (t) =>
    `<button type="button" class="chip" data-tech="${t.id}" aria-pressed="${idea.techs.includes(t.id)}" title="${esc(t.what)}">${esc(t.name)}<span class="n" title="lượt nhắc tuần này">${t.total}</span></button>`;
  const chips = (list) => `<div class="chips">${list.map(chip).join('')}</div>`;
  if (!p) {
    setHTML('#tech-picker', `<div class="pick-label">Xếp theo số lượt được nhắc tuần này</div>${chips(techs)}`);
    return;
  }
  const key = new Set(p.key ?? []);
  const ease = easing(p);
  const far = techs.filter((t) => !key.has(t.id) && !ease.has(t.id));
  const open = $('#tech-picker .far')?.open || far.some((t) => idea.techs.includes(t.id));
  setHTML(
    '#tech-picker',
    [
      ['★ Hợp nhất với bài toán này', techs.filter((t) => key.has(t.id))],
      ['Cũng gỡ được nút thắt của nó', techs.filter((t) => !key.has(t.id) && ease.has(t.id))],
    ]
      .filter(([, list]) => list.length)
      .map(([title, list]) => `<div class="pick-label">${title}</div>${chips(list)}`)
      .join('') +
      (far.length ? `<details class="far"${open ? ' open' : ''}><summary>Bước nhảy xa: ${far.length} công nghệ khác, cho ý tưởng lạ ${icon('chevron')}</summary>${chips(far)}</details>` : ''),
  );
}

function renderIdeaCard() {
  const p = problemOf(idea.problem);
  if (!p) {
    setHTML('#idea-card', `<div class="idea-empty">${icon('bulb')}<p>Chọn một bài toán, hoặc bấm <b>Ngẫu nhiên</b>, để thấy ý tưởng nháp ở đây.</p><button class="linkbtn" type="button" data-view="sparks">Chưa có ý? Xem tia lửa hôm nay ${icon('arrow')}</button></div>`);
    return;
  }
  const facts = `<dl class="facts">
    ${p.who ? `<dt>Ai đang gặp</dt><dd>${esc(p.who)}</dd>` : ''}
    ${p.pain ? `<dt>Nỗi đau</dt><dd>${esc(p.pain)}</dd>` : ''}
    ${p.today ? `<dt>Hiện người ta làm</dt><dd>${esc(p.today)}</dd>` : ''}
  </dl>`;
  const remove = p.mine ? `<button class="linkbtn danger" type="button" data-del-problem="${esc(p.id)}">Xóa bài toán này</button>` : '';
  const parts = ideaParts();
  if (!parts) {
    setHTML('#idea-card', `<div class="idea-area">${esc(p.area)}</div><h3 class="idea-title">${esc(p.title)}</h3>${facts}
      <p class="hint">Giờ chọn công nghệ ở bước 2. Nhóm <b>★ Hợp nhất</b> là chỗ bắt đầu tốt; <b>Bước nhảy xa</b> cho ý tưởng lạ hơn.</p>${remove}`);
    return;
  }
  const { techs, solved, linked, question } = parts;

  const solvedHtml = solved.length
    ? `<div class="chips">${solved.map((n) => `<span class="node-pill">${esc(nodeOf(n).name)}</span>`).join('')}</div>`
    : '<p class="hint">Công nghệ này không gỡ trực tiếp nút thắt nào đã biết của bài toán, nên đây là một bước nhảy xa. Hãy tự hỏi: nó giúp được ở khâu nào?</p>';

  const top = solved.length ? nodeOf(solved[0]).name : '';
  const linkedHtml = linked.length
    ? `<p class="hint">Cùng lời giải này dùng được cho <b>${linked.length} bài toán khác</b>. Thử nghĩ sản phẩm thành <b>nền tảng gỡ nút “${esc(top)}”</b> cho tất cả, thay vì một ứng dụng lẻ.</p>
       <div class="linked">${linked
         .slice(0, 6)
         .map(({ q, shared }) => `<button type="button" class="link-problem" data-problem="${esc(q.id)}" title="Chuyển sang bài toán này, giữ nguyên công nghệ"><b>${esc(q.title)}</b><small>chung nút: ${shared.map((n) => esc(nodeOf(n).name)).join(', ')}</small></button>`)
         .join('')}</div>`
    : '<p class="hint">Chưa thấy bài toán nào khác dùng chung nút thắt này.</p>';

  const nowHtml = techs
    .map((t) => {
      const parts = [t.repos && `${t.repos} repo hot`, t.news && `${t.news} bài báo`, t.hf && `${t.hf} mô hình/ứng dụng`].filter(Boolean);
      return `<li><b>${esc(t.name)}</b>: ${t.total ? `${t.total} lượt nhắc tuần này (${parts.join(', ')})` : 'chưa được nhắc nhiều tuần này: có thể còn sớm, hoặc bạn đang đi trước'}</li>`;
    })
    .join('');
  const talk = data.ideas.items
    .filter((it) => it.p.includes(p.id))
    .sort((a, b) => (a.k === 'news') - (b.k === 'news') || 0)
    .slice(0, 3);
  const talkHtml = talk.length
    ? `<li>Bài toán này: ${p.mentions} tin, nghiên cứu, repo gần đây có nhắc tới, ví dụ:<ul class="talk">${talk.map((it) => `<li>${kindTag(it.k)} ${link(it.url, esc(tx(it, 'title')))}</li>`).join('')}</ul></li>`
    : '';

  const perKind = {};
  const mats = data.ideas.items
    .filter((it) => it.k !== 'news' && it.t.some((t) => idea.techs.includes(t)))
    .map((it) => ({ it, s: (it.p.includes(p.id) ? 10 : 0) + it.t.filter((t) => idea.techs.includes(t)).length * 2 - KIND_RANK[it.k] * 0.1 }))
    .sort((a, b) => b.s - a.s)
    .filter(({ it }) => (perKind[it.k] = (perKind[it.k] ?? 0) + 1) <= 3)
    .slice(0, 6)
    .map(({ it }) => it);
  const matsHtml = mats.length
    ? `<ul class="mats">${mats
        .map((it) => {
          const desc = tx(it, 'desc');
          return `<li><div class="meta">${kindTag(it.k)}<span>·</span><span>${esc(it.note)}</span></div>${link(it.url, esc(tx(it, 'title')), 'mat-name')}${desc ? `<div class="mat-desc">${esc(desc)}</div>` : ''}</li>`;
        })
        .join('')}</ul>`
    : '<p class="hint">Tuần này chưa thấy repo hay mô hình nào nổi bật cho công nghệ này. Tìm thêm ở tab Công nghệ &amp; công cụ.</p>';

  const start = hashStr(`${p.id}${idea.techs.join()}`);
  const prompts = [0, 3, 7].map((d) => PROMPTS[(start + d) % PROMPTS.length]);

  setHTML(
    '#idea-card',
    `<div class="idea-area">${esc(p.area)} · ${esc(p.title)}</div>
    <p class="idea-q">${esc(question)}</p>
    <div class="idea-techs">${techs.map((t) => `<div><b>${esc(t.name)}:</b> ${esc(t.what)}</div>`).join('')}</div>
    ${facts}
    <section class="idea-sec"><h4>Nút thắt được gỡ</h4>${solvedHtml}</section>
    <section class="idea-sec"><h4>Liên kết sang bài toán khác</h4>${linkedHtml}</section>
    <section class="idea-sec"><h4>Vì sao là bây giờ</h4><ul class="now">${nowHtml}${talkHtml}</ul></section>
    <section class="idea-sec"><h4>Nguyên liệu có sẵn để làm thử</h4>${matsHtml}</section>
    <section class="idea-sec"><h4>Câu hỏi đào sâu</h4><ul class="prompts">${prompts.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></section>
    ${remove}`,
  );
}

function renderIdeaScore() {
  const el = $('#idea-score');
  const parts = ideaParts();
  el.hidden = !parts;
  if (!parts) return;
  const hints = {
    many: parts.linked.length ? `Dữ liệu: liên kết được với ${parts.linked.length} bài toán khác` : '',
    now: `Dữ liệu: ${parts.techs.map((t) => `${t.name} ${t.total} lượt nhắc`).join(', ')} tuần này`,
  };
  const v = verdict(idea.scores);
  el.innerHTML = `<h3>Ý tưởng này có đáng làm không?</h3>
    <p class="sub">Tự chấm 1–5 cho từng câu, càng thật càng tốt: chấm thấp sớm đỡ mất nhiều tháng làm sai hướng.</p>
    ${CRITERIA.map(
      (c) => `<div class="crit">
        <div class="crit-text"><b>${c.name}</b><span>${c.q}</span>${hints[c.id] ? `<small>${esc(hints[c.id])}</small>` : ''}</div>
        <div class="dots" role="group" aria-label="${c.name}">${[1, 2, 3, 4, 5]
          .map((n) => `<button type="button" data-score="${c.id}" data-v="${n}" aria-pressed="${(idea.scores[c.id] ?? 0) >= n}" aria-label="${n} điểm">${n}</button>`)
          .join('')}</div>
      </div>`,
    ).join('')}
    <div class="verdict ${v.cls}">${v.text}</div>
    <textarea id="idea-note" rows="3" placeholder="Ghi chú: tên sản phẩm, 5 người đầu tiên sẽ hỏi thử, bản thử nhỏ nhất…" aria-label="Ghi chú">${esc(idea.note)}</textarea>
    <div class="idea-actions">
      <button class="btn primary" type="button" data-act="save">${idea.entryId ? 'Cập nhật trong sổ' : 'Lưu vào sổ'}</button>
      <button class="btn" type="button" data-act="copy">Sao chép</button>
    </div>`;
}

function renderComposer() {
  renderProblemPicker();
  renderTechPicker();
  renderIdeaCard();
  renderIdeaScore();
}

function renderNodes() {
  const problems = allProblems();
  setHTML(
    '#nodes',
    data.ideas.nodes
      .map((n) => ({ n, ps: problems.filter((p) => p.nodes.includes(n.id)) }))
      .sort((a, b) => b.ps.length - a.ps.length)
      .map(
        ({ n, ps }) => `<article class="node">
          <div class="node-head"><h3>${esc(n.name)}</h3><span class="node-count">${ps.length} bài toán</span></div>
          <p>${esc(n.desc)}</p>
          <div class="pick-label">Gặp ở</div>
          <div class="chips">${ps.map((p) => `<button type="button" class="chip" data-problem="${esc(p.id)}" data-go>${esc(p.title)}</button>`).join('')}</div>
          <div class="pick-label">Công nghệ gỡ được</div>
          <div class="chips">${n.techs
            .map(techOf)
            .filter(Boolean)
            .map((t) => `<button type="button" class="chip" data-tech="${t.id}" data-go title="${esc(t.what)}">${esc(t.name)}<span class="n">${t.total}</span></button>`)
            .join('')}</div>
        </article>`,
      )
      .join(''),
  );
}

function entryMarkdown(e) {
  const v = verdict(e.scores);
  const techs = e.techs.map((id) => techOf(id)?.name ?? id).join(', ');
  return [
    `## ${e.question}`,
    `- Ngày: ${fmtDate(e.at)}`,
    `- Bài toán: ${e.problemTitle}`,
    `- Công nghệ: ${techs}`,
    `- Tự chấm: ${v.total != null ? `${v.total}/30 (${v.label})` : 'chưa chấm đủ'} — ${CRITERIA.map((c) => `${c.name} ${e.scores[c.id] ?? '–'}`).join(', ')}`,
    e.note ? `- Ghi chú: ${e.note}` : '',
  ].filter(Boolean).join('\n');
}

function currentEntry() {
  const parts = ideaParts();
  return {
    id: idea.entryId ?? Date.now().toString(36),
    at: new Date().toISOString(),
    problem: parts.p.id,
    problemTitle: parts.p.title,
    techs: [...idea.techs],
    question: parts.question,
    scores: { ...idea.scores },
    note: idea.note.trim(),
  };
}

function renderBook() {
  setCount('book', book.length);
  if (!book.length) {
    setHTML('#book', '<p class="empty">Chưa có ý tưởng nào. Ghép một ý tưởng, chấm điểm rồi bấm “Lưu vào sổ”.</p>');
    return;
  }
  setHTML(
    '#book',
    `<div class="book-head"><span class="muted">${book.length} ý tưởng</span><button class="btn" type="button" data-act="export">${icon('download')}Tải sổ về (.md)</button></div>
    <div class="book-list">${book
      .slice()
      .reverse()
      .map((e) => {
        const v = verdict(e.scores);
        return `<article class="book-item">
          <div class="meta"><span>${fmtDate(e.at)}</span><span class="pill ${v.cls}">${v.total != null ? `${v.total}/30 · ${v.label}` : 'chưa chấm đủ'}</span></div>
          <h3>${esc(e.question)}</h3>
          <div class="meta"><span>Bài toán: ${esc(e.problemTitle)}</span></div>
          ${e.note ? `<p>${esc(e.note)}</p>` : ''}
          <div class="book-actions"><button class="linkbtn" type="button" data-open="${esc(e.id)}">Mở lại</button><button class="linkbtn danger" type="button" data-del="${esc(e.id)}">Xóa</button></div>
        </article>`;
      })
      .join('')}</div>`,
  );
}

function renderIdeas(res, force = false) {
  // A refresh with unchanged data must not rebuild the form someone is typing in.
  if (!force && data.ideas?.generatedAt === res.generatedAt) return;
  data.ideas = res;
  if (idea.problem && !problemOf(idea.problem)) Object.assign(idea, { problem: null, techs: [], scores: {}, note: '', entryId: null });
  idea.techs = idea.techs.filter((id) => techOf(id));
  setHTML('#my-nodes', res.nodes.map((n) => `<label class="chip check"><input type="checkbox" name="node" value="${n.id}">${esc(n.name)}</label>`).join(''));
  renderSparks();
  renderComposer();
  renderNodes();
  renderBook();
}

// The ideas tab has four views: today's sparks, composer, bottleneck map, notebook.
function setIdeaView(view) {
  for (const b of $$('#idea-view [data-view]')) b.setAttribute('aria-pressed', b.dataset.view === view);
  for (const pane of $$('[data-view-pane]')) pane.hidden = pane.dataset.viewPane !== view;
}

function pickIdea(next) {
  Object.assign(idea, { scores: {}, note: '', entryId: null }, next);
  renderComposer();
}

// Picking a problem shows a draft straight away: keep the chosen technologies
// if they still ease it, otherwise start from its best fit that people talk
// about most this week. The reader swaps it in step 2.
function chooseProblem(id) {
  const p = problemOf(id);
  if (!p) return;
  const ease = easing(p);
  let techs = idea.techs.filter((t) => ease.has(t));
  if (!techs.length) {
    const pool = p.key?.length ? p.key : [...ease];
    const best = pool.map(techOf).filter(Boolean).sort((a, b) => b.total - a.total)[0];
    techs = best ? [best.id] : [];
  }
  pickIdea({ problem: id, techs });
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1500);
}

function saveBook() {
  remember('ideaBook', JSON.stringify(book));
  renderBook();
}

function ideaAction(t) {
  const ds = t.dataset;
  if (ds.score) {
    idea.scores[ds.score] = Number(ds.v);
    renderIdeaScore();
    return;
  }
  if (ds.problem) {
    chooseProblem(ds.problem);
  } else if (ds.tech) {
    const techs = idea.techs.includes(ds.tech) ? idea.techs.filter((id) => id !== ds.tech) : [...idea.techs, ds.tech].slice(-2);
    const completes = !idea.techs.length && techs.length && idea.problem;
    pickIdea({ techs });
    // On narrow screens the draft sits below the pickers: bring it into view once.
    if (completes && !('go' in ds) && matchMedia('(max-width: 1000px)').matches) $('#idea-card').scrollIntoView({ block: 'start' });
  } else if (ds.spark) {
    const s = data.ideas.sparks[Number(ds.spark)];
    if (s) pickIdea({ problem: s.problem, techs: [s.tech] });
  } else if (ds.act === 'random') {
    const all = allProblems();
    const p = all[Math.floor(Math.random() * all.length)];
    const pool = p.key?.length ? p.key : [...easing(p)];
    pickIdea({ problem: p.id, techs: [pool[Math.floor(Math.random() * pool.length)]] });
  } else if (ds.act === 'save') {
    const entry = currentEntry();
    const i = book.findIndex((e) => e.id === entry.id);
    if (i >= 0) book[i] = { ...entry, at: book[i].at };
    else book.push(entry);
    idea.entryId = entry.id;
    saveBook();
    renderIdeaScore();
    flash($('#idea-score [data-act="save"]'), 'Đã lưu ✓');
  } else if (ds.act === 'copy') {
    navigator.clipboard.writeText(entryMarkdown(currentEntry())).then(() => flash(t, 'Đã chép ✓'), () => flash(t, 'Không chép được'));
  } else if (ds.act === 'export') {
    const md = `# Sổ ý tưởng\n\n${book.map(entryMarkdown).join('\n\n')}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `so-y-tuong-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (ds.open) {
    const e = book.find((x) => x.id === ds.open);
    if (!e) return;
    if (!problemOf(e.problem)) { alert('Bài toán của ý tưởng này đã bị xóa nên không mở lại được.'); return; }
    pickIdea({ problem: e.problem, techs: [...e.techs], scores: { ...e.scores }, note: e.note, entryId: e.id });
  } else if (ds.del) {
    if (!confirm('Xóa ý tưởng này khỏi sổ?')) return;
    book = book.filter((e) => e.id !== ds.del);
    if (idea.entryId === ds.del) idea.entryId = null;
    saveBook();
    renderIdeaScore();
    return;
  } else if (ds.delProblem) {
    if (!confirm('Xóa bài toán này? Các ý tưởng đã lưu vẫn còn trong sổ.')) return;
    myProblems = myProblems.filter((p) => p.id !== ds.delProblem);
    remember('myProblems', JSON.stringify(myProblems));
    pickIdea({ problem: null, techs: [] });
    renderNodes();
    return;
  }
  if ('go' in ds || ds.spark || ds.open) {
    setIdeaView('compose');
    $('#composer').scrollIntoView({ block: 'start' });
  }
}

function initIdeas() {
  myProblems = stored('myProblems');
  book = stored('ideaBook');
  const page = $('#ideas');
  page.addEventListener('click', (e) => {
    const view = e.target.closest('[data-view]');
    if (view) { setIdeaView(view.dataset.view); return; }
    const t = e.target.closest('[data-problem],[data-tech],[data-spark],[data-act],[data-score],[data-open],[data-del],[data-del-problem]');
    if (t && data.ideas) ideaAction(t);
  });
  page.addEventListener('input', (e) => {
    if (e.target.id === 'idea-note') idea.note = e.target.value;
    if (e.target.id === 'problem-filter') { problemQuery = e.target.value; renderProblemPicker(); }
  });
  $('#problem-select').addEventListener('change', (e) => {
    if (data.ideas && e.target.value) chooseProblem(e.target.value);
  });
  $('#my-problem-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!data.ideas) return;
    const form = new FormData(e.target);
    const nodes = form.getAll('node');
    $('#my-problem-error').hidden = nodes.length > 0;
    if (!nodes.length) return;
    const p = { id: `my-${Date.now().toString(36)}`, area: 'Của bạn', title: String(form.get('title')).trim(), who: String(form.get('who')).trim(), nodes, key: [], mine: true };
    myProblems.push(p);
    remember('myProblems', JSON.stringify(myProblems));
    e.target.reset();
    e.target.closest('details').open = false;
    chooseProblem(p.id);
    renderNodes();
  });
}

// ---------- quick search (Ctrl/⌘ K) ----------

const PAGE_ICONS = { 'tong-quan': 'home', 'tin-tuc': 'news', repo: 'repo', 'cong-nghe': 'layers', 'y-tuong': 'bulb', 'nghien-cuu': 'book', 'ky-luc': 'trophy' };
// With an empty query, show only a few starting points.
const PAL_START = { 'Trang': 7, 'Tin tức': 4, 'Repo': 4 };
let palIndex = [];
let palItems = [];
let palSel = 0;

function searchIndex() {
  const out = [];
  for (const a of $$('.nav a[data-tab]')) out.push({ group: 'Trang', icon: PAGE_ICONS[a.dataset.tab], title: a.querySelector('span').textContent, tab: a.dataset.tab });
  for (const p of data.ideas ? allProblems() : []) out.push({ group: 'Bài toán', icon: 'bulb', title: p.title, sub: p.area, problem: p.id });
  for (const t of data.tech?.techs ?? []) out.push({ group: 'Công nghệ', icon: 'layers', title: t.name, sub: `${t.total} lượt nhắc`, tab: 'cong-nghe', extra: t.what });
  for (const r of [...(data.repos?.trending ?? []), ...(data.repos?.rising ?? [])]) out.push({ group: 'Repo', icon: 'repo', title: r.name, sub: tx(r, 'description'), url: r.url, extra: r.description });
  for (const m of data.models?.models ?? []) out.push({ group: 'Mô hình', icon: 'cpu', title: m.name.replace(/^[^:]+:\s*/, ''), sub: providerName(m.provider), url: m.url });
  for (const m of data.tools?.models ?? []) out.push({ group: 'Mô hình', icon: 'download', title: m.id, sub: m.taskVi ?? '', url: m.url });
  for (const s of data.tools?.spaces ?? []) out.push({ group: 'Ứng dụng', icon: 'spark', title: s.title, sub: tx(s, 'description'), url: s.url, extra: s.description });
  for (const p of data.papers?.papers ?? []) out.push({ group: 'Nghiên cứu', icon: 'book', title: tx(p, 'title'), sub: p.org ?? '', url: p.url, extra: p.title });
  for (const it of data.news?.items ?? []) out.push({ group: 'Tin tức', icon: 'news', title: tx(it, 'title'), sub: `${it.sourceName} · ${ago(it.date)}`, url: it.url, extra: it.title });
  for (const it of out) it.key = fold(`${it.title} ${it.sub ?? ''} ${it.extra ?? ''}`);
  return out;
}

function renderPalette() {
  const words = fold($('#palette-q').value).split(/\s+/).filter(Boolean);
  const groups = new Map();
  for (const it of palIndex) {
    const cap = words.length ? 6 : PAL_START[it.group];
    if (!cap || (words.length && !words.every((w) => it.key.includes(w)))) continue;
    const list = groups.get(it.group) ?? [];
    if (list.length < cap) groups.set(it.group, [...list, it]);
  }
  palItems = [...groups.values()].flat();
  palSel = Math.max(0, Math.min(palSel, palItems.length - 1));
  let n = 0;
  setHTML(
    '#palette-results',
    palItems.length
      ? [...groups]
          .map(([g, list]) => `<div class="pal-group">${g}</div>${list
            .map((it) => {
              const i = n++;
              return `<div class="pal-item" role="option" data-pal="${i}" aria-selected="${i === palSel}">${icon(it.icon)}<span class="t">${esc(it.title)}</span>${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ''}${it.url ? icon('external') : ''}</div>`;
            })
            .join('')}`)
          .join('')
      : '<p class="empty">Không tìm thấy gì. Thử từ khóa khác, ví dụ “agent”, “Claude”, “bảo mật”.</p>',
  );
}

function selectPal(i) {
  palSel = i;
  for (const el of $$('.pal-item')) el.setAttribute('aria-selected', Number(el.dataset.pal) === i);
  $(`.pal-item[data-pal="${i}"]`)?.scrollIntoView({ block: 'nearest' });
}

function openPalette() {
  palIndex = searchIndex();
  palSel = 0;
  $('#palette').hidden = false;
  $('#palette-q').value = '';
  renderPalette();
  $('#palette-q').focus();
}

function closePalette() {
  const pal = $('#palette');
  if (pal) pal.hidden = true;
}

function openPal(it) {
  if (!it) return;
  closePalette();
  if (it.url) {
    window.open(it.url, '_blank', 'noopener');
  } else if (it.problem) {
    goTab('y-tuong');
    setIdeaView('compose');
    chooseProblem(it.problem);
    $('#composer').scrollIntoView({ block: 'start' });
  } else if (it.tab) {
    goTab(it.tab);
  }
}

function initPalette() {
  const input = $('#palette-q');
  input.addEventListener('input', () => { palSel = 0; renderPalette(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (palItems.length) selectPal((palSel + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % palItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openPal(palItems[palSel]);
    }
  });
  const results = $('#palette-results');
  results.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.pal-item');
    if (el && Number(el.dataset.pal) !== palSel) selectPal(Number(el.dataset.pal));
  });
  results.addEventListener('click', (e) => {
    const el = e.target.closest('.pal-item');
    if (el) openPal(palItems[Number(el.dataset.pal)]);
  });
  $('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });
  for (const b of $$('[data-open-search]')) b.addEventListener('click', openPalette);
  if (/Mac|iPhone|iPad/.test(navigator.platform)) for (const k of $$('kbd')) k.textContent = k.textContent.replace('Ctrl', '⌘');
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if ($('#palette').hidden) openPalette();
      else closePalette();
    } else if (e.key === '/' && $('#palette').hidden && !e.target.closest('input, textarea, select, [contenteditable]')) {
      e.preventDefault();
      openPalette();
    } else if (e.key === 'Escape') {
      closePalette();
      closeSheet();
    }
  });
}

// ---------- phone "Thêm" sheet & theme ----------

function closeSheet() {
  const sheet = $('#more-sheet');
  if (sheet) sheet.hidden = true;
}

function syncThemeIcon() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  for (const use of $$('[data-theme-toggle] use')) use.setAttribute('href', dark ? '#i-sun' : '#i-moon');
}

// Re-render every text that has a Vietnamese version.
function renderLanguage() {
  const btn = $('#lang');
  if (btn) {
    btn.querySelector('span').textContent = state.lang === 'vi' ? 'Bản gốc' : 'Tiếng Việt';
    btn.title = state.lang === 'vi' ? 'Đang hiện bản dịch tiếng Việt. Bấm để xem tiêu đề gốc tiếng Anh.' : 'Đang hiện bản gốc. Bấm để xem bản dịch tiếng Việt.';
  }
  const mobile = $('#lang-mobile span');
  if (mobile) mobile.textContent = state.lang === 'vi' ? 'Xem bản gốc tiếng Anh' : 'Xem bản dịch tiếng Việt';
  if (data.news) { renderHot(); renderRiver(); renderOverviewHot(); }
  if (data.repos) renderRepos(data.repos);
  if (data.tech) renderTech(data.tech);
  if (data.models) renderModels(data.models);
  if (data.tools) renderTools(data.tools);
  if (data.papers) renderPapers(data.papers);
  if (data.ideas) renderIdeas(data.ideas, true);
}

// ---------- loading ----------

async function loadAll(force = false) {
  const btn = $('#refresh');
  btn?.classList.add('spin');
  if (btn) btn.disabled = true;
  const load = (name, render, targets) => api(name, force).then(render).catch((e) => fail(targets, e));
  await Promise.all([
    load('news', renderNews, ['#hot', '#river', '#ov-hot']),
    load('repos', renderRepos, ['#repos', '#ov-repos']),
    load('tech', renderTech, ['#tech', '#ov-tech']),
    load('models', renderModels, ['#models', '#ov-models']),
    load('tools', renderTools, ['#hf-models', '#hf-spaces']),
    load('papers', renderPapers, ['#papers']),
    load('progress', renderProgress, ['#bench', '#ov-bench', '#value-chart', '#race-chart', '#gap', '#leaderboard']),
    load('ideas', renderIdeas, ['#sparks', '#problem-picker', '#nodes', '#ov-sparks']),
  ]);
  btn?.classList.remove('spin');
  if (btn) btn.disabled = false;
}

// ---------- events ----------

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function initControls() {
  $('#range').innerHTML = Object.entries(RANGES).map(([d, l]) => `<option value="${d}">${l}</option>`).join('');
  $('#range').value = String(state.days);

  const rerender = () => { state.limit = 40; renderRiver(); };
  $('#cats').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.cat = chip.dataset.cat;
    rerender();
  });
  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value; rerender(); }, 150);
  });
  $('#range').addEventListener('change', (e) => { state.days = Number(e.target.value); rerender(); });
  $('#source').addEventListener('change', (e) => { state.source = e.target.value; rerender(); });
  $('#more').addEventListener('click', () => { state.limit += 40; renderRiver(); });
  $('#active-filter').addEventListener('click', (e) => {
    if (e.target.id === 'clear-trend') { state.trend = null; rerender(); }
  });
  $('#trends').addEventListener('click', (e) => {
    const row = e.target.closest('.trend');
    if (!row || !data.news) return;
    state.trend = data.news.trends.find((t) => t.name === row.dataset.trend) ?? null;
    if (state.days < 7) { state.days = 7; $('#range').value = '7'; }
    rerender();
    $('#river-block').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#hot').addEventListener('click', (e) => {
    if (e.target.id !== 'toggle-hot' || !data.news) return;
    showAllHot = !showAllHot;
    renderHot();
  });
  $('#models').addEventListener('click', (e) => {
    if (e.target.id !== 'toggle-models' || !data.models) return;
    showAllModels = !showAllModels;
    renderModels(data.models);
  });
  $('#repo-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !data.repos) return;
    state.repoMode = b.dataset.mode;
    renderRepos(data.repos);
  });
  $('#refresh').addEventListener('click', () => loadAll(true));

  // In-page "Xem tất cả →" links and tiles switch tabs and start at the top.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || !TABS.includes(a.getAttribute('href').slice(1))) return;
    e.preventDefault();
    goTab(a.getAttribute('href').slice(1));
    // An idea spark on the overview opens straight onto the composer.
    if (a.dataset.spark && data.ideas) ideaAction(a);
  });
  addEventListener('hashchange', route);
  addEventListener('resize', measureSticky);

  const toggleLang = () => {
    state.lang = state.lang === 'vi' ? 'en' : 'vi';
    remember('lang', state.lang);
    renderLanguage();
  };
  $('#lang')?.addEventListener('click', toggleLang);
  $('#lang-mobile')?.addEventListener('click', () => { toggleLang(); closeSheet(); });

  for (const b of $$('[data-theme-toggle]')) {
    b.addEventListener('click', () => {
      const root = document.documentElement;
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      remember('theme', root.dataset.theme);
      syncThemeIcon();
    });
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeIcon);

  $('#more-btn')?.addEventListener('click', () => { $('#more-sheet').hidden = false; });
  $('#more-sheet')?.addEventListener('click', (e) => { if (e.target.id === 'more-sheet') closeSheet(); });

  const today = $('#today');
  if (today) today.textContent = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' });
}

try {
  const theme = localStorage.getItem('theme');
  if (theme) document.documentElement.dataset.theme = theme;
  if (localStorage.getItem('lang') === 'en') state.lang = 'en';
} catch {}

// Right after a deploy the browser may pair a cached older index.html with this
// script; a missing control must never stop the data from loading.
try {
  initControls();
  route();
  measureSticky();
  renderLanguage();
  initSparkHover();
  initRace();
  initIdeas();
  initPalette();
  syncThemeIcon();
} catch (err) {
  console.error(err);
}
loadAll();
setInterval(() => loadAll(), REFRESH_MS);
// Keep "x phút trước" labels honest between refreshes.
setInterval(() => { if (data.news) { renderUpdated(); renderRiver(); } }, 60e3);
