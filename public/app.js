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
const CATS = { all: 'Tất cả', lab: 'Công ty AI', media: 'Báo nước ngoài', research: 'Nghiên cứu', community: 'Blog & diễn đàn', vn: 'Báo Việt' };
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
const translateUrl = (url) => `https://translate.google.com/translate?sl=auto&tl=vi&u=${encodeURIComponent(url)}`;
const thumb = (src, cls = 'thumb') =>
  src ? `<img class="${cls}" src="${esc(safeUrl(src))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
const avatar = (owner) => `<img class="avatar" src="https://github.com/${encodeURIComponent(owner)}.png?size=64" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
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
  for (const a of $$('.tabs a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  $(`.tabs a[data-tab="${tab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  document.title = tab === 'tong-quan' ? 'Xu hướng AI' : `${$(`.tabs a[data-tab="${tab}"]`)?.textContent} · Xu hướng AI`;
}

function goTab(tab) {
  if (location.hash.slice(1) !== tab) location.hash = tab;
  route();
  window.scrollTo(0, 0);
}

// Sticky header + tabs height, so the news filters stick right below them.
function measureSticky() {
  const h = $('#sticky')?.offsetHeight;
  if (h) document.documentElement.style.setProperty('--stick', `${h}px`);
}

// ---------- overview ----------

function renderPulse() {
  const { news, models, repos, progress } = data;
  const tiles = [];
  if (news) {
    const day = news.items.filter((it) => Date.now() - Date.parse(it.date) < DAY).length;
    const ok = news.sources.filter((s) => s.ok).length;
    tiles.push({ tab: 'tin-tuc', label: 'Tin mới trong 24 giờ qua', value: day, note: `tổng hợp từ ${ok} nguồn tin` });
  }
  if (repos?.trending.length) {
    const top = repos.trending[0];
    tiles.push({ tab: 'repo', label: 'Repo AI hot nhất tuần', value: esc(top.name.split('/')[1]), note: `+${nf0.format(top.week || top.today)} sao trong tuần`, small: true });
  }
  if (models) {
    const lead = models.byProvider[0];
    tiles.push({
      tab: 'cong-nghe',
      label: 'Mô hình AI mới (30 ngày)',
      value: models.last30,
      note: lead ? `ra nhiều nhất: ${esc(providerName(lead.provider))} (${lead.count})` : '',
    });
  }
  if (progress) {
    const latest = progress.benchmarks
      .map((b) => ({ b, r: b.record.at(-1) }))
      .sort((x, y) => Date.parse(y.r.date) - Date.parse(x.r.date))[0];
    if (latest) {
      tiles.push({
        tab: 'ky-luc',
        label: 'Kỷ lục AI mới nhất',
        value: esc(modelName(latest.r.model)),
        note: `${esc(latest.b.title)}: ${fmtScore(latest.b.kind, latest.r.score)}`,
        small: true,
      });
    }
  }
  setHTML(
    '#pulse',
    tiles
      .map((t) => `<a class="tile" href="#${t.tab}"><div class="label">${t.label}</div><div class="value${t.small ? ' small' : ''}">${t.value}</div><div class="note">${t.note}</div></a>`)
      .join(''),
  );
}

function renderOverviewHot() {
  const hot = data.news.hot.slice(0, 4);
  setHTML(
    '#ov-hot',
    hot.length
      ? hot
          .map(
            (c) => `<div class="ov-row">
              ${link(c.lead.url, esc(tx(c.lead, 'title')), 'ov-title')}
              <div class="meta"><span class="count">${c.sourceCount} nguồn</span><span>${ago(c.latest)}</span></div>
            </div>`,
          )
          .join('')
      : '<p class="empty">Chưa có tin nóng.</p>',
  );
}

function renderOverviewRepos() {
  setHTML(
    '#ov-repos',
    data.repos.trending
      .slice(0, 5)
      .map(
        (r) => `<div class="ov-row with-avatar">
          ${avatar(r.name.split('/')[0])}
          <div>
            ${link(r.url, `${esc(r.name.split('/')[0])}/<b>${esc(r.name.split('/')[1])}</b>`, 'ov-title')}
            <div class="ov-desc">${esc(tx(r, 'description'))}</div>
            <div class="meta"><span class="up">▲ ${nf0.format(r.week || r.today)} sao tuần này</span><span>·</span><span>★ ${big(r.stars)}</span></div>
          </div>
        </div>`,
      )
      .join(''),
  );
}

function renderOverviewTech() {
  const list = data.tech.techs.slice(0, 6);
  setHTML(
    '#ov-tech',
    list
      .map(
        (t) => `<a class="ov-row tech-mini" href="#cong-nghe">
          <div class="tech-mini-head"><b>${esc(t.name)}</b><span class="muted">${t.total} lượt nhắc</span></div>
          <div class="ov-desc">${esc(t.what)}</div>
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
        (m) => `<div class="ov-row">
          ${link(m.url, esc(m.name.replace(/^[^:]+:\s*/, '')), 'ov-title')}
          <div class="meta"><span class="src">${esc(providerName(m.provider))}</span><span>·</span><span>${ago(m.created)}</span>${m.free ? '<span class="tag">Miễn phí</span>' : ''}</div>
        </div>`,
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
          <div class="note">${esc(b.caption)}</div>
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
  const f = (v) => (log ? Math.log10(v) : v);
  const lo = log ? f(pts[0].v) : 0;
  const hi = log ? f(Math.max(...pts.map((p) => p.v))) : 1;
  const x = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v) => H - P - ((f(v) - lo) / (hi - lo || 1)) * (H - 2 * P);
  return { pts: pts.map((p) => ({ ...p, x: x(p.t), y: y(p.v) })), xEnd: x(t1), base: H - P, top: y(log ? pts.at(-1).v : 1) };
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
          <details><summary>Xem 5 mô hình đứng đầu (trong ${b.evaluated} mô hình đã thử)</summary><table>${rows}</table></details>
        </article>`;
      })
      .join(''),
  );
  renderOverviewBench();
  renderPulse();
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

// ---------- news ----------

function readLink(url, lang) {
  if (lang === 'vi') return '';
  return `<span>·</span><a class="tr" href="${translateUrl(url)}" target="_blank" rel="noopener noreferrer" title="Mở bài gốc đã dịch sang tiếng Việt bằng Google Dịch">Đọc bài bằng tiếng Việt</a>`;
}

function metaRow(it, extra = '') {
  return `<div class="meta"><span class="dot cat-${it.cat}" title="${CATS[it.cat]}"></span><span class="src">${esc(it.sourceName)}</span><span>·</span><time datetime="${it.date}" title="${new Date(it.date).toLocaleString('vi-VN')}">${ago(it.date)}</time>${extra}${readLink(it.url, it.lang)}</div>`;
}

function renderHot() {
  const news = data.news;
  if (!news.hot.length) {
    setHTML('#hot', '<p class="empty">Chưa có sự kiện nào được nhiều báo cùng đưa trong vài ngày qua.</p>');
    return;
  }
  setHTML(
    '#hot',
    news.hot
      .map((c) => {
        const it = c.lead;
        const related = c.related
          .slice(0, 6)
          .map((r) => `<li><b>${esc(r.sourceName)}:</b> ${link(r.url, esc(tx(r, 'title')))}</li>`)
          .join('');
        const summary = tx(it, 'summary');
        return `<article class="hot">
          <div>
            ${metaRow(it, `<span class="count">${c.sourceCount} nguồn cùng đưa tin</span>`)}
            ${link(it.url, esc(tx(it, 'title')), 'title')}
            ${summary ? `<p class="sum">${esc(summary)}</p>` : ''}
            ${related ? `<div class="related-label">Các nguồn khác viết:</div><ul class="related">${related}</ul>` : ''}
          </div>
          ${thumb(it.image)}
        </article>`;
      })
      .join(''),
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
    state.trend ? `Đang xem tin về: <strong>${esc(state.trend.name)}</strong> <button type="button" id="clear-trend">Bỏ lọc ✕</button>` : '',
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
          <div>
            ${metaRow(it)}
            ${link(it.url, esc(tx(it, 'title')), 'title')}
            ${summary ? `<p class="sum">${esc(summary)}</p>` : ''}
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
              <span><span class="bar" style="display:block;width:${(t.now / max) * 100}%"></span></span>
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
  const el = $('#updated');
  el.textContent = `Cập nhật ${ago(data.news.generatedAt)}`;
  el.title = new Date(data.news.generatedAt).toLocaleString('vi-VN');
}

function renderNews(news) {
  data.news = news;
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
  const rising = state.repoMode === 'rising';
  const list = rising ? repos.rising : repos.trending;
  for (const b of $$('#repo-mode button')) b.setAttribute('aria-pressed', b.dataset.mode === state.repoMode);
  setHTML(
    '#repo-hint',
    rising
      ? 'Repo về AI được tạo trong 30 ngày qua, xếp theo tổng số sao.'
      : 'Repo về AI trên <a href="https://github.com/trending?since=weekly" target="_blank" rel="noopener">GitHub Trending</a>, xếp theo số sao tăng thêm trong tuần.',
  );
  if (!list.length) {
    setHTML('#repos', `<p class="empty">${rising && repos.risingError ? 'Chưa lấy được danh sách repo mới (GitHub giới hạn lượt truy cập). Lần cập nhật sau sẽ có.' : 'Chưa có dữ liệu.'}</p>`);
  } else {
    setHTML(
      '#repos',
      list
        .map((r, i) => {
          const [owner, name] = r.name.split('/');
          const growth = rising
            ? `<span>tạo ${ago(r.created)}</span>`
            : `<span class="up">▲ ${nf0.format(r.week || r.today)} sao ${r.week ? 'tuần này' : 'hôm nay'}</span>`;
          const topics = (r.topics ?? []).slice(0, 5).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
          return `<article class="repo">
            <div class="rank">${i + 1}</div>
            ${avatar(owner)}
            <div class="repo-body">
              ${link(r.url, `${esc(owner)}/<b>${esc(name)}</b>`, 'repo-name')}
              ${r.description ? `<p>${esc(tx(r, 'description'))}</p>` : ''}
              <div class="meta">${growth}<span>·</span><span>★ ${nf0.format(r.stars)} sao</span>${r.language ? `<span>·</span><span>${esc(r.language)}</span>` : ''}${topics}</div>
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
        const headline = t.headline ? `<div class="tech-news">📰 ${link(t.headline.url, esc(tx(t.headline, 'title')))} <span class="muted">— ${esc(t.headline.source)}</span></div>` : '';
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
            <div class="meta"><span class="src">${esc(providerName(m.provider))}</span><span>·</span><span>ra mắt ${ago(m.created)}</span>${m.free ? '<span>·</span><span class="tag">Miễn phí</span>' : ''}</div>
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
          ${link(m.url, esc(m.id.split('/')[1]), 'name')}
          <div class="meta"><span class="src">${esc(m.author)}</span>${m.taskVi ? `<span>·</span><span class="tag">${esc(m.taskVi)}</span>` : ''}</div>
          <div class="meta"><span>♥ ${big(m.likes)} lượt thích</span><span>·</span><span>⬇ ${big(m.downloads)} lượt tải</span></div>
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
          <div class="meta"><span class="src">${esc(s.author)}</span><span>·</span><span>♥ ${big(s.likes)}</span></div>
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
    res.papers
      .slice(0, 24)
      .map((p) => {
        const summary = tx(p, 'summary');
        return `<article class="paper">
          ${link(p.url, esc(tx(p, 'title')), 'name')}
          <div class="meta"><span class="votes">▲ ${p.upvotes} lượt thích</span>${p.org ? `<span>·</span><span>${esc(p.org)}</span>` : ''}<span>·</span><span>${ago(p.date)}</span></div>
          ${summary ? `<p>${esc(summary)}</p>` : ''}
        </article>`;
      })
      .join(''),
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
  'Kênh: người dùng đang ở sẵn đâu (Zalo, Facebook, cuộc gọi điện thoại)? Chạy ngay ở đó được không?',
  'Rủi ro: nếu AI sai một lần thì hậu quả là gì, và ai kiểm tra lại?',
  'Dữ liệu: dữ liệu để làm thử lấy ở đâu? Ai đang giữ mà chưa dùng tới?',
  'Vì sao chưa ai làm: rào cản thật sự là công nghệ, luật, hay thói quen?',
];

const idea = { problem: null, techs: [], scores: {}, note: '', entryId: null };
let myProblems = [];
let book = [];

function stored(key) {
  try { return JSON.parse(localStorage.getItem(key)) ?? []; } catch { return []; }
}

function hashStr(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

const allProblems = () => [...(data.ideas?.problems ?? []), ...myProblems];
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
  return `<article class="spark-card">
    <div class="meta">${kindTag(it.k)}<span>·</span><span>${esc(it.note)}</span><span class="tag">${s.strong ? 'Đúng chủ đề' : 'Kết nối bất ngờ'}</span></div>
    ${link(it.url, esc(tx(it, 'title')), 'spark-src')}
    ${desc ? `<p class="spark-desc">${esc(desc)}</p>` : ''}
    <div class="spark-join">ghép với bài toán</div>
    <div class="spark-problem"><small>${esc(p.area)}</small>${esc(p.title)}</div>
    <p class="spark-q">${esc(q)}</p>
    <button class="linkbtn" type="button" data-spark="${i}">Phát triển ý tưởng này →</button>
  </article>`;
}

function renderSparks() {
  const { sparks } = data.ideas;
  setHTML('#sparks', sparks.length ? sparks.map((s, i) => sparkCard(s, i)).join('') : '<p class="empty">Hôm nay chưa ghép được tia lửa nào.</p>');
  setHTML('#ov-sparks', sparks.length ? sparks.slice(0, 3).map((s, i) => sparkCard(s, i, true)).join('') : '<p class="empty">Hôm nay chưa ghép được tia lửa nào.</p>');
}

function renderProblemPicker() {
  setHTML(
    '#problem-picker',
    allProblems()
      .map((p) => `<button type="button" class="pick${p.mine ? ' mine' : ''}" data-problem="${esc(p.id)}" aria-pressed="${idea.problem === p.id}"><small>${esc(p.area)}</small>${esc(p.title)}</button>`)
      .join(''),
  );
}

function renderTechPicker() {
  const techs = [...data.ideas.techs].sort((a, b) => b.total - a.total);
  const p = problemOf(idea.problem);
  const chip = (t) =>
    `<button type="button" class="chip" data-tech="${t.id}" aria-pressed="${idea.techs.includes(t.id)}" title="${esc(t.what)}">${esc(t.name)}<span class="n" title="lượt nhắc tuần này">${t.total}</span></button>`;
  let groups = [['Xếp theo số lượt được nhắc tuần này', techs]];
  if (p) {
    const key = new Set(p.key ?? []);
    const ease = easing(p);
    groups = [
      ['★ Hợp nhất với bài toán này', techs.filter((t) => key.has(t.id))],
      ['Cũng gỡ được nút thắt của nó', techs.filter((t) => !key.has(t.id) && ease.has(t.id))],
      ['Bước nhảy xa: thử nếu muốn ý tưởng lạ', techs.filter((t) => !key.has(t.id) && !ease.has(t.id))],
    ];
  }
  setHTML(
    '#tech-picker',
    groups
      .filter(([, list]) => list.length)
      .map(([title, list]) => `<div class="pick-label">${title}</div><div class="chips">${list.map(chip).join('')}</div>`)
      .join(''),
  );
}

function renderIdeaCard() {
  const p = problemOf(idea.problem);
  if (!p) {
    setHTML('#idea-card', '<div class="idea-empty"><div class="bulb">💡</div><p>Chọn một bài toán và một công nghệ, hoặc bấm <b>🎲 Ghép ngẫu nhiên</b>, để thấy ý tưởng nháp ở đây.</p></div>');
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
  if (!book.length) {
    setHTML('#book', '<p class="empty">Chưa có ý tưởng nào. Ghép một ý tưởng, chấm điểm rồi bấm “Lưu vào sổ”.</p>');
    return;
  }
  setHTML(
    '#book',
    `<div class="book-head"><span class="muted">${book.length} ý tưởng</span><button class="btn" type="button" data-act="export">Tải sổ về (.md)</button></div>
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
  if (!$('#my-nodes')?.children.length) {
    setHTML('#my-nodes', res.nodes.map((n) => `<label class="chip check"><input type="checkbox" name="node" value="${n.id}">${esc(n.name)}</label>`).join(''));
  }
  renderSparks();
  renderComposer();
  renderNodes();
  renderBook();
}

function pickIdea(next) {
  Object.assign(idea, { scores: {}, note: '', entryId: null }, next);
  renderComposer();
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
    pickIdea({ problem: ds.problem });
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
  if ('go' in ds || ds.spark || ds.open) $('#composer').scrollIntoView({ block: 'start' });
}

function initIdeas() {
  myProblems = stored('myProblems');
  book = stored('ideaBook');
  const page = $('#ideas');
  page.addEventListener('click', (e) => {
    const t = e.target.closest('[data-problem],[data-tech],[data-spark],[data-act],[data-score],[data-open],[data-del],[data-del-problem]');
    if (t && data.ideas) ideaAction(t);
  });
  page.addEventListener('input', (e) => {
    if (e.target.id === 'idea-note') idea.note = e.target.value;
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
    pickIdea({ problem: p.id });
    renderNodes();
  });
}

// Re-render every text that has a Vietnamese version.
function renderLanguage() {
  const btn = $('#lang');
  if (btn) {
    btn.textContent = state.lang === 'vi' ? 'Bản gốc' : 'Tiếng Việt';
    btn.title = state.lang === 'vi' ? 'Đang hiện bản dịch tiếng Việt. Bấm để xem tiêu đề gốc tiếng Anh.' : 'Đang hiện bản gốc. Bấm để xem bản dịch tiếng Việt.';
  }
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
  btn.disabled = true;
  btn.textContent = 'Đang tải…';
  const load = (name, render, targets) => api(name, force).then(render).catch((e) => fail(targets, e));
  await Promise.all([
    load('news', renderNews, ['#hot', '#river', '#ov-hot']),
    load('repos', renderRepos, ['#repos', '#ov-repos']),
    load('tech', renderTech, ['#tech', '#ov-tech']),
    load('models', renderModels, ['#models', '#ov-models']),
    load('tools', renderTools, ['#hf-models', '#hf-spaces']),
    load('papers', renderPapers, ['#papers']),
    load('progress', renderProgress, ['#bench', '#ov-bench']),
    load('ideas', renderIdeas, ['#sparks', '#problem-picker', '#nodes', '#ov-sparks']),
  ]);
  btn.disabled = false;
  btn.textContent = 'Làm mới';
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

  $('#lang')?.addEventListener('click', () => {
    state.lang = state.lang === 'vi' ? 'en' : 'vi';
    remember('lang', state.lang);
    renderLanguage();
  });

  $('#theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    remember('theme', root.dataset.theme);
  });
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
  initIdeas();
} catch (err) {
  console.error(err);
}
loadAll();
setInterval(() => loadAll(), REFRESH_MS);
// Keep "x phút trước" labels honest between refreshes.
setInterval(() => { if (data.news) { renderUpdated(); renderRiver(); } }, 60e3);
