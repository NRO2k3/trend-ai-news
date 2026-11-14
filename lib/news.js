import { createHash } from 'node:crypto';
import { parseFeed } from './feed.js';
import { cached, fetchText, truncate } from './util.js';

const AI_TERMS = /\b(AI|A\.I\.|LLMs?|GPT[-\w.]*|ChatGPT|OpenAI|Anthropic|Claude|Gemini|DeepMind|Llama|Mistral|DeepSeek|Qwen|Grok|xAI|Copilot|agents?|agentic|machine learning|neural|chatbots?|trí tuệ nhân tạo|robot\w*|Nvidia)\b/i;

// cat: lab = primary announcements, media = journalism, community = blogs / HN,
// research = papers & technical digests, vn = Vietnamese press.
export const SOURCES = [
  { id: 'openai', name: 'OpenAI', cat: 'lab', url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind', name: 'Google DeepMind', cat: 'lab', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'google-ai', name: 'Google AI', cat: 'lab', url: 'https://blog.google/technology/ai/rss/' },
  { id: 'huggingface', name: 'Hugging Face', cat: 'lab', url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'nvidia', name: 'NVIDIA', cat: 'lab', url: 'https://blogs.nvidia.com/feed/', filter: AI_TERMS },
  { id: 'techcrunch', name: 'TechCrunch', cat: 'media', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { id: 'verge', name: 'The Verge', cat: 'media', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { id: 'mittr', name: 'MIT Tech Review', cat: 'media', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed' },
  { id: 'ars', name: 'Ars Technica', cat: 'media', url: 'https://arstechnica.com/ai/feed/' },
  { id: 'wired', name: 'Wired', cat: 'media', url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
  { id: 'decoder', name: 'The Decoder', cat: 'media', url: 'https://the-decoder.com/feed/' },
  { id: 'marktechpost', name: 'MarkTechPost', cat: 'research', url: 'https://www.marktechpost.com/feed/' },
  { id: 'importai', name: 'Import AI', cat: 'research', url: 'https://importai.substack.com/feed' },
  { id: 'hn', name: 'Hacker News', cat: 'community', url: 'https://hnrss.org/newest?q=AI&points=80', filter: AI_TERMS, noSummary: true },
  { id: 'simonw', name: 'Simon Willison', cat: 'community', url: 'https://simonwillison.net/atom/everything/' },
  { id: 'vnexpress', name: 'VnExpress', cat: 'vn', lang: 'vi', url: 'https://vnexpress.net/rss/so-hoa.rss', filter: AI_TERMS },
];

const MAX_PER_SOURCE = 30;
const MAX_AGE_DAYS = 45;
const DAY = 86400e3;

// Things people track to see who is moving: labs/companies and topics.
const TRACKED = [
  { kind: 'org', name: 'OpenAI', re: /\b(openai|chatgpt|gpt-?\d[\w.]*|sora|codex)\b/i },
  { kind: 'org', name: 'Google', re: /\b(google|gemini|deepmind|gemma|veo)\b/i },
  { kind: 'org', name: 'Anthropic', re: /\b(anthropic|claude)\b/i },
  { kind: 'org', name: 'Meta', re: /\b(meta|llama)\b/i },
  { kind: 'org', name: 'Microsoft', re: /\b(microsoft|copilot|azure)\b/i },
  { kind: 'org', name: 'NVIDIA', re: /\bnvidia\b/i },
  { kind: 'org', name: 'xAI', re: /\b(xai|grok)\b/i },
  { kind: 'org', name: 'Apple', re: /\bapple\b/i },
  { kind: 'org', name: 'Amazon', re: /\b(amazon|aws|alexa)\b/i },
  { kind: 'org', name: 'DeepSeek', re: /\bdeepseek\b/i },
  { kind: 'org', name: 'Alibaba / Qwen', re: /\b(alibaba|qwen)\b/i },
  { kind: 'org', name: 'Mistral', re: /\bmistral\b/i },
  { kind: 'topic', name: 'AI Agent', re: /\b(agents?|agentic)\b/i },
  { kind: 'topic', name: 'Lập trình', re: /\b(coding|coders?|developers?|programming|vibe cod\w*)\b/i },
  { kind: 'topic', name: 'Chip & hạ tầng', re: /\b(chips?|gpus?|tpus?|data ?cent(?:er|re)s?|semiconductors?|compute)\b/i },
  { kind: 'topic', name: 'Gọi vốn & IPO', re: /\b(raises?|raised|funding|valuation|ipo|investors?)\b/i },
  { kind: 'topic', name: 'Luật & chính sách', re: /\b(regulat\w*|laws?|lawsuits?|policy|policies|courts?|congress|senate|ban)\b/i },
  { kind: 'topic', name: 'An toàn AI', re: /\b(safety|alignment|jailbreak\w*|misuse|deepfakes?)\b/i },
  { kind: 'topic', name: 'Mã nguồn mở', re: /\bopen[- ](?:source|weights?)\b/i },
  { kind: 'topic', name: 'Robot', re: /\b(robot\w*|humanoids?)\b/i },
  { kind: 'topic', name: 'Video & hình ảnh', re: /\b(video|image generat\w*|text-to-image|text-to-video)\b/i },
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

const LEAD_RANK = { lab: 0, media: 1, research: 2, community: 3, vn: 4 };

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
  const items = results
    .flatMap((r) => r.items)
    .filter((it) => !seen.has(it.url) && seen.add(it.url))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return {
    generatedAt: new Date().toISOString(),
    sources: results.map((r) => r.status),
    items,
    hot: cluster(items),
    trends: trends(items),
  };
});
