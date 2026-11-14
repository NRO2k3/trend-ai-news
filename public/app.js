'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const DAY = 86400e3;
const REFRESH_MS = 15 * 60e3;

const CATS = { all: 'Tất cả', lab: 'Phòng lab', media: 'Báo chí', research: 'Nghiên cứu', community: 'Cộng đồng', vn: 'Việt Nam' };
const RANGES = { 1: '24 giờ qua', 3: '3 ngày qua', 7: '7 ngày qua', 30: '30 ngày qua' };

const state = { cat: 'all', days: 3, q: '', source: '', trend: null, limit: 40 };
const data = { news: null, models: null, progress: null };

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

const translateUrl = (url) => `https://translate.google.com/translate?sl=auto&tl=vi&u=${encodeURIComponent(url)}`;
const thumb = (src, cls = 'thumb') =>
  src ? `<img class="${cls}" src="${esc(safeUrl(src))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';

const prettyModel = (m) => m.replace(/_unknown$/, '').replace(/_([a-z]+)$/i, ' ($1)');

function fmtScore(kind, v) {
  if (kind === 'minutes') return v >= 60 ? `${nf1.format(v / 60)} giờ` : `${nf1.format(v)} phút`;
  return `${nf1.format(v * 100)}%`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

async function api(name, force) {
  const res = await fetch(`data/${name}.json` + (force ? `?refresh=${Date.now()}` : ''));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function fail(el, err) {
  $(el).innerHTML = `<p class="error">Không tải được dữ liệu (${esc(err.message)}). Thử bấm “Làm mới”.</p>`;
}

// ---------- pulse tiles ----------

function renderPulse() {
  const { news, models, progress } = data;
  const tiles = [];
  if (news) {
    const day = news.items.filter((it) => Date.now() - Date.parse(it.date) < DAY).length;
    const ok = news.sources.filter((s) => s.ok).length;
    tiles.push({ label: 'Tin mới trong 24 giờ', value: day, note: `từ ${ok}/${news.sources.length} nguồn đang hoạt động` });
    const top = news.trends.find((t) => t.kind === 'org');
    if (top) tiles.push({ label: 'Được nhắc nhiều nhất tuần này', value: esc(top.name), note: `${top.now} tin trong 7 ngày`, small: true });
  }
  if (models) {
    const lead = models.byProvider[0];
    tiles.push({ label: 'Mô hình mới trong 30 ngày', value: models.last30, note: lead ? `nhiều nhất: ${esc(lead.provider)} (${lead.count})` : '' });
  }
  if (progress) {
    const latest = progress.benchmarks
      .map((b) => ({ b, r: b.record.at(-1) }))
      .sort((x, y) => Date.parse(y.r.date) - Date.parse(x.r.date))[0];
    if (latest) {
      tiles.push({
        label: 'Kỷ lục mới nhất',
        value: `${esc(prettyModel(latest.r.model))}`,
        note: `${esc(latest.b.name)}: ${fmtScore(latest.b.kind, latest.r.score)} · ${fmtDate(latest.r.date)}`,
        small: true,
      });
    }
  }
  $('#pulse').innerHTML = tiles
    .map((t) => `<div class="tile"><div class="label">${t.label}</div><div class="value${t.small ? ' small' : ''}">${t.value}</div><div class="note">${t.note}</div></div>`)
    .join('');
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
  const label = `Biểu đồ kỷ lục ${b.name} theo thời gian, từ ${fmtScore(b.kind, g.pts[0].v)} lên ${fmtScore(b.kind, g.pts.at(-1).v)}`;
  return `<svg class="spark" data-i="${i}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    ${b.kind === 'pct' ? `<line class="grid" x1="0" x2="${W}" y1="${g.top}" y2="${g.top}"/>` : ''}
    <line class="base" x1="0" x2="${W}" y1="${g.base}" y2="${g.base}"/>
    <path class="area" d="${area}"/><path class="line" d="${d}" vector-effect="non-scaling-stroke"/>${dots}
    <rect class="hit" x="0" y="0" width="${W}" height="${H}"/>
  </svg>`;
}

function renderProgress(progress) {
  data.progress = progress;
  $('#bench').innerHTML = progress.benchmarks
    .map((b, i) => {
      const L = b.leader;
      let delta = '';
      if (b.yearAgo) {
        delta =
          b.kind === 'minutes'
            ? `<b>×${nf1.format(L.score / b.yearAgo.score)}</b> so với 12 tháng trước (${fmtScore(b.kind, b.yearAgo.score)})`
            : `<b>+${nf1.format((L.score - b.yearAgo.score) * 100)} điểm</b> so với 12 tháng trước (${fmtScore(b.kind, b.yearAgo.score)})`;
      }
      const rows = b.top
        .map((t) => `<tr><td>${esc(prettyModel(t.model))}<br><small>${esc(t.org)} · ${fmtDate(t.date)}</small></td><td>${fmtScore(b.kind, t.score)}</td></tr>`)
        .join('');
      return `<article class="bench">
        <h3>${esc(b.name)}</h3>
        <div class="desc">${esc(b.desc)}</div>
        <div class="big">${fmtScore(b.kind, L.score)}</div>
        <div class="who" title="${esc(prettyModel(L.model))}">${esc(prettyModel(L.model))} · ${esc(L.org)}</div>
        ${delta ? `<div class="delta">${delta}</div>` : ''}
        ${sparkline(b, i)}
        <div class="axis"><span>${new Date(b.record[0].date).getFullYear()}</span><span>${b.kind === 'minutes' ? 'thang log · ' : ''}nay</span></div>
        <details><summary>Top 5 trong ${b.evaluated} mô hình đã đo</summary><table>${rows}</table></details>
      </article>`;
    })
    .join('');
  renderPulse();
}

// Crosshair-style hover: snap to the nearest record point.
function initSparkHover() {
  const tip = $('#tip');
  let lastDot = null;
  const clear = () => {
    tip.hidden = true;
    lastDot?.classList.remove('on');
    lastDot = null;
  };
  $('#bench').addEventListener('mousemove', (e) => {
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
    tip.innerHTML = `<b>${fmtScore(b.kind, p.v)}</b> — ${esc(prettyModel(p.r.model))}<br>${esc(p.r.org)} · ${fmtDate(p.r.date)}`;
    tip.hidden = false;
    const tx = rect.left + (p.x / SPARK.W) * rect.width;
    const ty = rect.top + (p.y / SPARK.H) * rect.height;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, tx - tip.offsetWidth / 2))}px`;
    tip.style.top = `${ty - tip.offsetHeight - 12}px`;
  });
  $('#bench').addEventListener('mouseleave', clear);
}

// ---------- news ----------

function metaRow(it) {
  return `<div class="meta"><span class="dot cat-${it.cat}" title="${CATS[it.cat]}"></span><span class="src">${esc(it.sourceName)}</span><span>·</span><time datetime="${it.date}" title="${new Date(it.date).toLocaleString('vi-VN')}">${ago(it.date)}</time>${
    it.lang !== 'vi' ? `<span>·</span><a class="tr" href="${translateUrl(it.url)}" target="_blank" rel="noopener noreferrer">Dịch</a>` : ''
  }</div>`;
}

function renderHot(news) {
  if (!news.hot.length) {
    $('#hot').innerHTML = '<p class="empty">Chưa có sự kiện nào được nhiều nguồn cùng đưa trong vài ngày qua.</p>';
    return;
  }
  $('#hot').innerHTML = news.hot
    .map((c) => {
      const it = c.lead;
      const related = c.related
        .slice(0, 6)
        .map((r) => `<li><b>${esc(r.sourceName)}:</b> <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></li>`)
        .join('');
      return `<article class="hot">
        <div>
          ${metaRow(it).replace('</div>', `<span class="count">${c.sourceCount} nguồn</span></div>`)}
          <a class="title" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>
          ${it.summary ? `<p class="sum">${esc(it.summary)}</p>` : ''}
          ${related ? `<ul class="related">${related}</ul>` : ''}
        </div>
        ${thumb(it.image)}
      </article>`;
    })
    .join('');
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
      (!q || `${it.title} ${it.summary} ${it.sourceName}`.toLowerCase().includes(q)),
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
  $('#cats').innerHTML = Object.entries(CATS)
    .map(
      ([k, label]) =>
        `<button class="chip" type="button" data-cat="${k}" aria-pressed="${state.cat === k}">${k !== 'all' ? `<span class="dot cat-${k}"></span>` : ''}${label}<span class="n">${counts[k] ?? 0}</span></button>`,
    )
    .join('');
}

function renderRiver() {
  renderChips();
  const list = filteredItems();
  $('#active-filter').innerHTML = state.trend
    ? `Đang lọc theo: <strong>${esc(state.trend.name)}</strong> <button type="button" id="clear-trend">Bỏ lọc ✕</button>`
    : '';
  if (!list.length) {
    $('#river').innerHTML = '<p class="empty">Không có tin nào khớp bộ lọc. Thử nới khoảng thời gian hoặc bỏ bớt điều kiện.</p>';
    $('#more').hidden = true;
    return;
  }
  let lastDay = '';
  $('#river').innerHTML = list
    .slice(0, state.limit)
    .map((it) => {
      const day = dayLabel(it.date);
      const head = day !== lastDay ? `<h3 class="day">${day}</h3>` : '';
      lastDay = day;
      return `${head}<article class="item">
        <div>
          ${metaRow(it)}
          <a class="title" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>
          ${it.summary ? `<p class="sum">${esc(it.summary)}</p>` : ''}
        </div>
        ${thumb(it.image)}
      </article>`;
    })
    .join('');
  $('#more').hidden = list.length <= state.limit;
  $('#more').textContent = `Xem thêm (${list.length - state.limit} tin)`;
}

function renderTrends(news) {
  const groups = [
    ['org', 'Công ty & phòng lab'],
    ['topic', 'Chủ đề'],
  ];
  const max = Math.max(1, ...news.trends.map((t) => t.now));
  $('#trends').innerHTML = groups
    .map(([kind, title]) => {
      const rows = news.trends
        .filter((t) => t.kind === kind && (t.now || t.before))
        .slice(0, 8)
        .map((t) => {
          const diff = t.now - t.before;
          const delta = diff > 0 ? `<small class="up">▲${diff}</small>` : diff < 0 ? `<small class="down">▼${-diff}</small>` : '<small>–</small>';
          return `<button class="trend" type="button" data-trend="${esc(t.name)}" title="${t.now} tin tuần này, ${t.before} tin tuần trước">
            <span class="name">${esc(t.name)}</span>
            <span><span class="bar" style="display:block;width:${(t.now / max) * 100}%"></span></span>
            <span class="val">${t.now} ${delta}</span>
          </button>`;
        })
        .join('');
      return rows ? `<div class="trend-group">${title}</div>${rows}` : '';
    })
    .join('');
}

function renderSources(news) {
  const sel = $('#source');
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Mọi nguồn</option>' +
    news.sources.filter((s) => s.ok).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = current;
  $('#sources').innerHTML = `<ul class="src-list">${news.sources
    .map(
      (s) =>
        `<li><span class="dot cat-${s.cat}"></span>${esc(s.name)}<span class="n ${s.ok ? '' : 'bad'}" title="${esc(s.error ?? '')}">${s.ok ? s.count : 'lỗi'}</span></li>`,
    )
    .join('')}</ul>`;
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
  renderHot(news);
  renderTrends(news);
  renderSources(news);
  renderRiver();
  renderPulse();
}

// ---------- models & papers ----------

let showAllModels = false;

function renderModels(models) {
  data.models = models;
  $('#models-sub').innerHTML = `${models.last30} mô hình mới trong 30 ngày · theo <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter</a>`;
  const list = showAllModels ? models.models : models.models.slice(0, 8);
  const price = (m) => (m.free ? 'Miễn phí' : m.priceIn != null ? `$${nf1.format(m.priceIn)} / $${nf1.format(m.priceOut ?? 0)} mỗi 1M token` : '');
  const ctx = (n) => (n >= 1e6 ? `${nf1.format(n / 1e6)}M ctx` : `${Math.round(n / 1000)}K ctx`);
  $('#models').innerHTML =
    `<div class="providers">${models.byProvider
      .slice(0, 8)
      .map((p) => `<span class="tag">${esc(p.provider)} ${p.count}</span>`)
      .join('')}</div>` +
    list
      .map(
        (m) => `<div class="mini">
          <a class="name" href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">${esc(m.name)}</a>
          <div class="meta"><span>${ago(m.created)}</span>${m.context ? `<span>·</span><span>${ctx(m.context)}</span>` : ''}${price(m) ? `<span>·</span><span>${price(m)}</span>` : ''}</div>
          ${m.description ? `<p>${esc(m.description)}</p>` : ''}
        </div>`,
      )
      .join('') +
    (models.models.length > 8 ? `<button class="linkbtn" type="button" id="toggle-models">${showAllModels ? 'Thu gọn' : `Xem tất cả ${models.models.length} mô hình (60 ngày)`}</button>` : '');
  renderPulse();
}

function renderPapers(res) {
  $('#papers').innerHTML = res.papers
    .slice(0, 8)
    .map(
      (p) => `<div class="mini">
        <a class="name" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(p.title)}</a>
        <div class="meta"><span class="votes">▲ ${p.upvotes}</span>${p.org ? `<span>·</span><span>${esc(p.org)}</span>` : ''}<span>·</span><a class="tr" href="${translateUrl(p.url)}" target="_blank" rel="noopener noreferrer">Dịch</a></div>
        ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
      </div>`,
    )
    .join('');
}

// ---------- loading ----------

async function loadAll(force = false) {
  const btn = $('#refresh');
  btn.disabled = true;
  btn.textContent = 'Đang tải…';
  await Promise.all([
    api('news', force).then(renderNews).catch((e) => { fail('#hot', e); fail('#river', e); }),
    api('models', force).then(renderModels).catch((e) => fail('#models', e)),
    api('papers', force).then(renderPapers).catch((e) => fail('#papers', e)),
    api('progress', force).then(renderProgress).catch((e) => fail('#bench', e)),
  ]);
  btn.disabled = false;
  btn.textContent = 'Làm mới';
}

// ---------- events ----------

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
  $('#refresh').addEventListener('click', () => loadAll(true));

  $('#theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  });
}

try {
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}

initControls();
initSparkHover();
loadAll();
setInterval(() => loadAll(), REFRESH_MS);
// Keep "x phút trước" labels honest between refreshes.
setInterval(() => { if (data.news) { renderUpdated(); renderRiver(); } }, 60e3);
