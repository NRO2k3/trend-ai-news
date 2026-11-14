import { getNews } from './news.js';
import { getPapers } from './papers.js';
import { NODES, PROBLEMS } from './problems.js';
import { getRepos } from './repos.js';
import { getTech, TECH, techIds } from './tech.js';
import { getTools } from './tools.js';
import { cached, truncate } from './util.js';

const DAY = 86400e3;
const nf = new Intl.NumberFormat('vi-VN');
const node = Object.fromEntries(NODES.map((n) => [n.id, n]));

// Technologies that loosen at least one of a problem's bottlenecks.
const fixes = (problem) => new Set(problem.nodes.flatMap((n) => node[n].techs));

// Match names like "text-to-image" both as written and with separators as spaces.
const both = (text) => `${text} ${text.replace(/[/_-]/g, ' ')}`;
const problemIds = (text) => PROBLEMS.filter((p) => p.re.test(text)).map((p) => p.id);

// Stable within a day, different the next: rotates which problem a spark is paired with.
function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// Nearly every model paper mentions these, so on their own they make a weak link.
const VAGUE = new Set(['reasoning', 'open']);

// Pairs today's hot repos, papers and apps with problems they could help solve.
// First pass: the item is about the problem, or uses a technology that attacks it
// directly (`key`); second pass loosens to any technology that eases a bottleneck.
function sparks(items, techs) {
  const heat = Object.fromEntries(techs.map((t) => [t.id, t.total]));
  const day = new Date().toISOString().slice(0, 10);
  const rank = {};
  const pool = items
    .map((it, i) => ({ it, i, r: (rank[it.k] = (rank[it.k] ?? -1) + 1) }))
    .filter(({ it, r }) => ['repo', 'paper', 'space'].includes(it.k) && r < 15 && it.t.length);

  const picked = [];
  const perKind = {};
  const bestPair = ({ it, i, r }, loose) => {
    let best = null;
    for (const p of PROBLEMS) {
      if (picked.some((x) => x.p === p)) continue;
      const strong = it.p.includes(p.id);
      // A paper only earns a spark by being about the problem; loose links from research read as noise.
      if (!strong && it.k === 'paper') continue;
      const allowed = strong ? new Set(it.t) : loose ? fixes(p) : new Set(p.key);
      const shared = it.t.filter((id) => allowed.has(id) && (strong || !VAGUE.has(id)));
      if (!shared.length) continue;
      const score = (strong ? 10 : 0) + shared.length + (hash(`${it.url}${day}${p.id}`) % 100) / 1000;
      if (!best || score > best.score) best = { i, r, k: it.k, p, shared, strong, score };
    }
    return best;
  };
  const fill = (loose, max) => {
    while (picked.length < max) {
      const next = pool
        .filter((c) => !picked.some((x) => x.i === c.i) && (perKind[c.it.k] ?? 0) < 3)
        .map((c) => bestPair(c, loose))
        .filter(Boolean)
        .sort((a, b) => b.strong - a.strong || a.r - b.r || b.score - a.score)[0];
      if (!next) return;
      perKind[next.k] = (perKind[next.k] ?? 0) + 1;
      picked.push(next);
    }
  };
  fill(false, 6);
  fill(true, 4);
  return picked.map((s) => ({
    item: s.i,
    problem: s.p.id,
    tech: [...s.shared].sort((a, b) => (heat[b] ?? 0) - (heat[a] ?? 0))[0],
    strong: s.strong,
  }));
}

export const getIdeas = cached(60 * 60e3, async () => {
  const [news, repos, tools, papers, tech] = await Promise.all([
    getNews().catch(() => ({ items: [] })),
    getRepos().catch(() => ({ trending: [], rising: [] })),
    getTools().catch(() => ({ models: [], spaces: [] })),
    getPapers().catch(() => ({ papers: [] })),
    getTech().catch(() => ({ techs: [] })),
  ]);

  // Things that exist right now, tagged with the technologies they use (t) and
  // the problems they are about (p): the raw material for an idea.
  const items = [];
  const add = (it, text, about = text) => {
    const t = techIds(both(text));
    const p = problemIds(both(about));
    if (t.length || p.length) items.push({ ...it, t, p });
  };
  for (const r of repos.trending) {
    add({ k: 'repo', title: r.name, desc: r.description, descVi: r.descriptionVi, url: r.url, note: `+${nf.format(r.week || r.today)} sao ${r.week ? 'tuần này' : 'hôm nay'}` },
      `${r.name} ${r.description}`);
  }
  for (const r of repos.rising) {
    add({ k: 'repo', title: r.name, desc: r.description, descVi: r.descriptionVi, url: r.url, note: `mới tạo · ${nf.format(r.stars)} sao` },
      `${r.name} ${r.description} ${(r.topics ?? []).join(' ')}`);
  }
  for (const p of papers.papers.slice(0, 40)) {
    add({ k: 'paper', title: p.title, titleVi: p.titleVi, desc: p.summary, descVi: p.summaryVi, url: p.url, note: `${nf.format(p.upvotes)} lượt thích` },
      `${p.title} ${p.summary}`, p.title); // research borrows domain words loosely ("teacher" model)
  }
  for (const m of tools.models) {
    add({ k: 'model', title: m.id, desc: m.taskVi ?? m.task ?? '', url: m.url, note: `${nf.format(m.likes)} lượt thích` },
      `${m.id} ${m.task ?? ''} ${m.tags.join(' ')}`);
  }
  for (const s of tools.spaces) {
    add({ k: 'space', title: `${s.emoji ? `${s.emoji} ` : ''}${s.title}`, desc: s.description, descVi: s.descriptionVi, url: s.url, note: `${nf.format(s.likes)} lượt thích` },
      `${s.id} ${s.title} ${s.description}`); // tags like "mcp-server" say how it runs, not what it does
  }
  // News only where it is about one of the problems: shows people care about it now.
  const recent = news.items.filter((it) => Date.now() - Date.parse(it.date) <= 14 * DAY);
  let newsCount = 0;
  for (const n of recent) {
    if (newsCount === 150) break;
    const text = `${n.title} ${n.summary}`;
    if (!problemIds(text).length) continue;
    newsCount++;
    add({ k: 'news', title: n.title, titleVi: n.titleVi, url: n.url, note: n.sourceName, date: n.date }, text);
  }
  for (const it of items) {
    if (it.desc) it.desc = truncate(it.desc, 180);
    if (it.descVi) it.descVi = truncate(it.descVi, 180);
  }

  const stats = Object.fromEntries(tech.techs.map((t) => [t.id, t]));
  const techs = TECH.map(({ id, name, can, what }) => {
    const s = stats[id];
    return { id, name, can, what, total: s?.total ?? 0, repos: s?.repos ?? 0, news: s?.news ?? 0, hf: s?.hf ?? 0 };
  });

  return {
    generatedAt: new Date().toISOString(),
    nodes: NODES,
    problems: PROBLEMS.map(({ re, ...p }) => ({ ...p, mentions: items.filter((it) => it.p.includes(p.id)).length })),
    techs,
    items,
    sparks: sparks(items, techs),
  };
});
