'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const nf1 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
const DAY = 86400e3;
const REFRESH_MS = 15 * 60e3;

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

const state = { cat: 'all', days: 3, q: '', source: '', trend: null, limit: 40, lang: 'vi' };
const data = { news: null, models: null, papers: null, progress: null };

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

// Vietnamese machine translation when available and wanted, otherwise the original.
const tx = (obj, field) => (state.lang === 'vi' && obj[`${field}Vi`]) || obj[field] || '';

const translateUrl = (url) => `https://translate.google.com/translate?sl=auto&tl=vi&u=${encodeURIComponent(url)}`;
const thumb = (src, cls = 'thumb') =>
  src ? `<img class="${cls}" src="${esc(safeUrl(src))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
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
    tiles.push({ label: 'Tin mới trong 24 giờ qua', value: day, note: `tổng hợp từ ${ok} nguồn tin` });
    const top = news.trends.find((t) => t.kind === 'org');
    if (top) tiles.push({ label: 'Công ty được nói tới nhiều nhất', value: esc(top.name), note: `xuất hiện trong ${top.now} bài tuần này`, small: true });
  }
  if (models) {
    const lead = models.byProvider[0];
    tiles.push({
      label: 'Mô hình AI mới ra mắt (30 ngày)',
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
        label: 'Kỷ lục mới nhất',
        value: esc(modelName(latest.r.model)),
        note: `${esc(latest.b.title)}: ${fmtScore(latest.b.kind, latest.r.score)}`,
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
  $('#bench').innerHTML = progress.benchmarks
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
            `<tr><td>${esc(modelName(t.model))} <small>(${esc(t.org)})</small>${effortOf(t.model) ? `<br><small>${effortOf(t.model)} · ${fmtDate(t.date)}</small>` : `<br><small>${fmtDate(t.date)}</small>`}</td><td>${fmtScore(b.kind, t.score)}</td></tr>`,
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
    tip.innerHTML = `Kỷ lục <b>${fmtScore(b.kind, p.v)}</b><br>${esc(modelName(p.r.model))} (${esc(p.r.org)})<br>${fmtDate(p.r.date)}`;
    tip.hidden = false;
    const tx = rect.left + (p.x / SPARK.W) * rect.width;
    const ty = rect.top + (p.y / SPARK.H) * rect.height;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, tx - tip.offsetWidth / 2))}px`;
    tip.style.top = `${ty - tip.offsetHeight - 12}px`;
  });
  $('#bench').addEventListener('mouseleave', clear);
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
    $('#hot').innerHTML = '<p class="empty">Chưa có sự kiện nào được nhiều báo cùng đưa trong vài ngày qua.</p>';
    return;
  }
  $('#hot').innerHTML = news.hot
    .map((c) => {
      const it = c.lead;
      const related = c.related
        .slice(0, 6)
        .map((r) => `<li><b>${esc(r.sourceName)}:</b> <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">${esc(tx(r, 'title'))}</a></li>`)
        .join('');
      const summary = tx(it, 'summary');
      return `<article class="hot">
        <div>
          ${metaRow(it, `<span class="count">${c.sourceCount} nguồn cùng đưa tin</span>`)}
          <a class="title" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(tx(it, 'title'))}</a>
          ${summary ? `<p class="sum">${esc(summary)}</p>` : ''}
          ${related ? `<div class="related-label">Các nguồn khác viết:</div><ul class="related">${related}</ul>` : ''}
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
  $('#cats').innerHTML = Object.entries(CATS)
    .map(
      ([k, label]) =>
        `<button class="chip" type="button" data-cat="${k}" aria-pressed="${state.cat === k}">${k !== 'all' ? `<span class="dot cat-${k}"></span>` : ''}${label}<span class="n">${counts[k] ?? 0}</span></button>`,
    )
    .join('');
}

function renderRiver() {
  if (!data.news) return;
  renderChips();
  const list = filteredItems();
  $('#active-filter').innerHTML = state.trend
    ? `Đang xem tin về: <strong>${esc(state.trend.name)}</strong> <button type="button" id="clear-trend">Bỏ lọc ✕</button>`
    : '';
  if (!list.length) {
    $('#river').innerHTML = '<p class="empty">Không có tin nào khớp. Thử chọn khoảng thời gian dài hơn hoặc bỏ bớt điều kiện lọc.</p>';
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
      const summary = tx(it, 'summary');
      return `${head}<article class="item">
        <div>
          ${metaRow(it)}
          <a class="title" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener noreferrer">${esc(tx(it, 'title'))}</a>
          ${summary ? `<p class="sum">${esc(summary)}</p>` : ''}
        </div>
        ${thumb(it.image)}
      </article>`;
    })
    .join('');
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
  $('#trends').innerHTML = groups
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
    .join('');
}

function renderSources() {
  const news = data.news;
  const sel = $('#source');
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Mọi nguồn</option>' +
    news.sources.filter((s) => s.ok).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = current;
  $('#sources').innerHTML = `<ul class="src-list">${news.sources
    .map(
      (s) =>
        `<li><span class="dot cat-${s.cat}" title="${CATS[s.cat]}"></span>${esc(s.name)}<span class="n ${s.ok ? '' : 'bad'}" title="${esc(s.error ?? '')}">${s.ok ? `${s.count} tin` : 'lỗi'}</span></li>`,
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
  renderHot();
  renderTrends();
  renderSources();
  renderRiver();
  renderPulse();
}

// ---------- models & papers ----------

let showAllModels = false;

function renderModels(models) {
  data.models = models;
  $('#models-sub').innerHTML = `${models.last30} mô hình mới trong 30 ngày qua · theo <a href="https://openrouter.ai/models" target="_blank" rel="noopener">OpenRouter</a>`;
  const list = showAllModels ? models.models : models.models.slice(0, 8);
  $('#models').innerHTML =
    `<div class="providers"><span class="muted">Hãng ra nhiều nhất:</span>${models.byProvider
      .slice(0, 6)
      .map((p) => `<span class="tag">${esc(providerName(p.provider))} ${p.count}</span>`)
      .join('')}</div>` +
    list
      .map((m) => {
        const desc = tx(m, 'description');
        return `<div class="mini">
          <a class="name" href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">${esc(m.name.replace(/^[^:]+:\s*/, ''))}</a>
          <div class="meta"><span class="src">${esc(providerName(m.provider))}</span><span>·</span><span>ra mắt ${ago(m.created)}</span>${m.free ? '<span>·</span><span class="tag">Miễn phí</span>' : ''}</div>
          ${desc ? `<p>${esc(desc)}</p>` : ''}
        </div>`;
      })
      .join('') +
    (models.models.length > 8 ? `<button class="linkbtn" type="button" id="toggle-models">${showAllModels ? 'Thu gọn' : `Xem tất cả ${models.models.length} mô hình (60 ngày qua)`}</button>` : '');
  renderPulse();
}

function renderPapers(res) {
  data.papers = res;
  $('#papers').innerHTML = res.papers
    .slice(0, 8)
    .map((p) => {
      const summary = tx(p, 'summary');
      return `<div class="mini">
        <a class="name" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">${esc(tx(p, 'title'))}</a>
        <div class="meta"><span class="votes">▲ ${p.upvotes} lượt thích</span>${p.org ? `<span>·</span><span>${esc(p.org)}</span>` : ''}</div>
        ${summary ? `<p>${esc(summary)}</p>` : ''}
      </div>`;
    })
    .join('');
}

// Re-render every text that has a Vietnamese version.
function renderLanguage() {
  $('#lang').textContent = state.lang === 'vi' ? 'Xem bản gốc' : 'Xem tiếng Việt';
  $('#lang').title = state.lang === 'vi' ? 'Đang hiện bản dịch tiếng Việt. Bấm để xem tiêu đề gốc tiếng Anh.' : 'Đang hiện bản gốc. Bấm để xem bản dịch tiếng Việt.';
  if (data.news) { renderHot(); renderRiver(); }
  if (data.models) renderModels(data.models);
  if (data.papers) renderPapers(data.papers);
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
  $('#refresh').addEventListener('click', () => loadAll(true));

  $('#lang').addEventListener('click', () => {
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

initControls();
renderLanguage();
initSparkHover();
loadAll();
setInterval(() => loadAll(), REFRESH_MS);
// Keep "x phút trước" labels honest between refreshes.
setInterval(() => { if (data.news) { renderUpdated(); renderRiver(); } }, 60e3);
