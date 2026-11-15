import { createHash } from 'node:crypto';
import { explain } from './explain.js';
import { parseFeed } from './feed.js';
import { translate } from './translate.js';
import { cached, fetchText, truncate } from './util.js';

const AI_TERMS = /\b(AI|A\.I\.|LLMs?|GPT[-\w.]*|ChatGPT|OpenAI|Anthropic|Claude|Gemini|DeepMind|Llama|Mistral|DeepSeek|Qwen|Grok|xAI|Copilot|Codex|Cursor|agents?|agentic|MCP|machine learning|neural|chatbots?|inference|models?)\b/i;
// Stories a web developer can't act on: money, courts, politics, hardware, robots,
// other industries, gossip.
const JUNK = /\b(raises?|raised|funding|valuation|ipo|investors?|lawsuits?|sues?|sued|court|judge|copyright|regulat\w*|senat\w*|congress|lawmakers?|elections?|politic\w*|governments?|federal|agencies|unions?|military|pentagon|manufactur\w*|factor(?:y|ies)|industrial|archaeolog\w*|maya|3d|faa|aviation|air traffic|robot\w*|humanoids?|self-driving|robotaxis?|waymo|chips?|semiconductors?|data ?cent(?:er|re)s?|power grid|stocks?|shares|earnings|layoffs?|resign\w*|steps down|deepfakes?|celebrit\w*|scandals?|affairs?|oust\w*|fired|feud|sagas?|turmoil|vcs?|ceos?|execs?|executives?|petition\w*|reinstat\w*|graveyard|shopping)\b/i;

// Chosen for web developers. cat: lab = AI companies' own announcements,
// dev = platforms web developers build on, media = tech press, research =
// technical digests, community = developer blogs / HN.
export const SOURCES = [
  { id: 'openai', name: 'OpenAI', cat: 'lab', url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind', name: 'Google DeepMind', cat: 'lab', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'google-ai', name: 'Google AI', cat: 'lab', url: 'https://blog.google/technology/ai/rss/' },
  { id: 'huggingface', name: 'Hugging Face', cat: 'lab', url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'github', name: 'GitHub Blog', cat: 'dev', url: 'https://github.blog/feed/', filter: AI_TERMS },
  { id: 'cloudflare', name: 'Cloudflare', cat: 'dev', url: 'https://blog.cloudflare.com/rss/', filter: AI_TERMS },
  { id: 'vercel', name: 'Vercel', cat: 'dev', url: 'https://vercel.com/atom', filter: AI_TERMS },
  { id: 'techcrunch', name: 'TechCrunch', cat: 'media', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'verge', name: 'The Verge', cat: 'media', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'ars', name: 'Ars Technica', cat: 'media', url: 'https://arstechnica.com/ai/feed/' },
  { id: 'decoder', name: 'The Decoder', cat: 'media', url: 'https://the-decoder.com/feed/' },
  { id: 'marktechpost', name: 'MarkTechPost', cat: 'research', url: 'https://www.marktechpost.com/feed/' },
  { id: 'hn', name: 'Hacker News', cat: 'community', url: 'https://hnrss.org/newest?q=AI&points=80', filter: AI_TERMS, noSummary: true },
  { id: 'simonw', name: 'Simon Willison', cat: 'community', url: 'https://simonwillison.net/atom/everything/' },
];

const MAX_PER_SOURCE = 30;
// Titles that are just a package name and version, e.g. "llm-gemini 0.31".
const RELEASE_NOTE = /^[a-z0-9][a-z0-9.@/_-]*\s+v?\d+(?:\.\d+)+[\w.-]*$/;
const MAX_AGE_DAYS = 45;
const DAY = 86400e3;

// Things people track to see who is moving: labs/companies and topics.
const TRACKED = [
  { kind: 'org', name: 'OpenAI', re: /\b(openai|chatgpt|gpt-?\d[\w.]*|codex)\b/i },
  { kind: 'org', name: 'Google', re: /\b(google|gemini|deepmind|gemma)\b/i },
  { kind: 'org', name: 'Anthropic', re: /\b(anthropic|claude)\b/i },
  { kind: 'org', name: 'Meta', re: /\b(meta|llama)\b/i },
  { kind: 'org', name: 'Microsoft / GitHub', re: /\b(microsoft|github|copilot|azure|vs ?code)\b/i },
  { kind: 'org', name: 'xAI', re: /\b(xai|grok)\b/i },
  { kind: 'org', name: 'Amazon / AWS', re: /\b(amazon|aws|bedrock)\b/i },
  { kind: 'org', name: 'DeepSeek', re: /\bdeepseek\b/i },
  { kind: 'org', name: 'Alibaba / Qwen', re: /\b(alibaba|qwen)\b/i },
  { kind: 'org', name: 'Mistral', re: /\bmistral\b/i },
  { kind: 'org', name: 'Cloudflare / Vercel', re: /\b(cloudflare|vercel|next\.?js)\b/i },
  { kind: 'topic', name: 'AI Agent', re: /\b(agents?|agentic)\b/i },
  { kind: 'topic', name: 'Lập trình', re: /\b(coding|coders?|developers?|programming|vibe cod\w*)\b/i },
  { kind: 'topic', name: 'Công cụ code', re: /\b(cursor|claude code|codex|copilot|windsurf|ides?)\b/i },
  { kind: 'topic', name: 'MCP', re: /\b(mcp|model context protocol)\b/i },
  { kind: 'topic', name: 'Bảo mật', re: /\b(security|vulnerabilit\w*|prompt injection|exploits?|malware|breach\w*)\b/i },
  { kind: 'topic', name: 'Giá & API', re: /\b(api|pricing|price[sd]?|cheaper|rate limits?)\b/i },
  { kind: 'topic', name: 'Mã nguồn mở', re: /\bopen[- ](?:source|weights?)\b/i },
];

const STOP = new Set(`a an the and or but of to in on for with at by from as is are was were be been it its this that these those
new says said how why what who when will can could would should may might has have had not no more most than into over about after
up out just now you your we our they their he she his her i my me ai artificial intelligence model models via vs report reportedly
first one two use using used make makes get gets here now launch launches launched announces announced introduces introducing
update updates its it's s also all some any like today week year`.split(/\s+/));

function tokens(title) {
  const words = title.toLowerCase().replace(/[’']s\b/g, '').split(/[^\p{L}\p{N}.\-]+/u);
  const out = new Set();
  for (let w of words) {
    w = w.replace(/^[.\-]+|[.\-]+$/g, '');
    if (w.length < 3 || STOP.has(w)) continue;
    if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

function similar(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  if (shared < 2) return false;
  const jaccard = shared / (a.size + b.size - shared);
  const overlap = shared / Math.min(a.size, b.size);
  return jaccard >= 0.3 || (shared >= 3 && overlap >= 0.5);
}

function cleanUrl(u) {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/.test(k)) url.searchParams.delete(k);
    url.hash = '';
    return url.toString();
  } catch {
    return u;
  }
}

async function loadSource(src) {
  const started = Date.now();
  try {
    const raw = parseFeed(await fetchText(src.url));
    const cutoff = Date.now() - MAX_AGE_DAYS * DAY;
    const items = raw
      .filter((it) => it.title && it.url && it.date && it.date.getTime() > cutoff)
      .filter((it) => !RELEASE_NOTE.test(it.title) && !JUNK.test(it.title))
      .filter((it) => !src.filter || src.filter.test(`${it.title} ${it.summary.slice(0, 300)}`))
      .sort((x, y) => y.date - x.date)
      .slice(0, MAX_PER_SOURCE)
      .map((it) => {
        const url = cleanUrl(it.url);
        return {
          id: createHash('sha1').update(url).digest('hex').slice(0, 12),
          title: it.title,
          url,
          date: it.date.toISOString(),
          summary: src.noSummary ? '' : truncate(it.summary, 260),
          // longer text for the note writer only; dropped before publishing
          text: src.noSummary ? '' : truncate(it.summary, 700),
          image: it.image || null,
          source: src.id,
          sourceName: src.name,
          cat: src.cat,
          lang: src.lang ?? 'en',
        };
      });
    return { status: { id: src.id, name: src.name, cat: src.cat, ok: true, count: items.length, ms: Date.now() - started }, items };
  } catch (err) {
    return { status: { id: src.id, name: src.name, cat: src.cat, ok: false, count: 0, error: err.message }, items: [] };
  }
}

const LEAD_RANK = { lab: 0, dev: 1, media: 2, research: 3, community: 4 };

// Groups stories about the same event across sources (Techmeme-style), so one
// launch covered by five outlets shows as one entry with five links.
function cluster(items) {
  const clusters = [];
  const toks = new Map(items.map((it) => [it.id, tokens(it.title)]));
  for (const it of items) {
    const t = toks.get(it.id);
    const time = Date.parse(it.date);
    const home = clusters.find(
      (c) => Math.abs(c.latest - time) < 3 * DAY && c.members.some((m) => m.source !== it.source && similar(t, toks.get(m.id))),
    );
    if (home) {
      home.members.push(it);
      home.latest = Math.max(home.latest, time);
    } else {
      clusters.push({ members: [it], latest: time });
    }
  }
  const now = Date.now();
  return clusters
    .map((c) => {
      const sources = new Set(c.members.map((m) => m.source));
      const sorted = [...c.members].sort((a, b) => LEAD_RANK[a.cat] - LEAD_RANK[b.cat] || Date.parse(a.date) - Date.parse(b.date));
      const ageH = (now - c.latest) / 3600e3;
      return {
        lead: sorted[0],
        related: sorted.slice(1),
        sourceCount: sources.size,
        latest: new Date(c.latest).toISOString(),
        score: sources.size + Math.max(0, 1 - ageH / 72) * 1.5,
        ageH,
      };
    })
    .filter((c) => c.sourceCount >= 2 && c.ageH <= 96)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ score, ageH, ...c }) => c);
}

function trends(items) {
  const now = Date.now();
  // pattern lets the page filter the news list by exactly what was counted
  const rows = TRACKED.map((t) => ({ kind: t.kind, name: t.name, pattern: t.re.source, now: 0, before: 0 }));
  for (const it of items) {
    const age = now - Date.parse(it.date);
    if (age > 14 * DAY) continue;
    const text = `${it.title} ${it.summary}`;
    TRACKED.forEach((t, i) => {
      if (t.re.test(text)) rows[i][age <= 7 * DAY ? 'now' : 'before']++;
    });
  }
  return rows.sort((a, b) => b.now - a.now);
}

export const getNews = cached(15 * 60e3, async () => {
  const results = await Promise.all(SOURCES.map(loadSource));
  const seen = new Set();
  const all = results
    .flatMap((r) => r.items)
    .filter((it) => !seen.has(it.url) && seen.add(it.url))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const { note, status } = await explain(all.map((it) => ({ key: it.id, type: 'tin', source: it.sourceName, title: it.title, text: it.text })));
  const items = [];
  const dropped = [];
  for (const { text, ...it } of all) {
    const n = note(it.id);
    if (n === null) dropped.push(it.id);
    else items.push(n ? { ...it, note: n } : it);
  }
  const english = items.filter((it) => it.lang !== 'vi');
  const vi = await translate(english.flatMap((it) => [it.note?.title ? '' : it.title, it.summary]));
  for (const it of english) {
    it.titleVi = it.note?.title || vi(it.title);
    it.summaryVi = vi(it.summary);
  }
  return {
    generatedAt: new Date().toISOString(),
    sources: results.map((r) => r.status),
    items,
    hot: cluster(items),
    trends: trends(items),
    ai: { ...status, dropped },
  };
});
