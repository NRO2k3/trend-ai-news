import { translate } from './translate.js';
import { cached, fetchText, plainText, truncate } from './util.js';

const DAY = 86400e3;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) TrendAINews/1.0';

// Trending covers every kind of project; keep the ones about AI.
export const AI_REPO =
  /\b(ai|llms?|gpt[\w.-]*|agents?|agentic|rag|mcp|diffusion|transformers?|claude|gemini|openai|anthropic|ollama|langchain|vllm|lora|fine-?tun\w*|inference|embeddings?|neural|machine learning|deep learning|ml|chatbots?|copilot|prompts?|tts|speech|voice|vision|ocr|multimodal|qwen|llama|deepseek|mistral|model context protocol|computer[- ]use|browser[- ]use|whisper|comfyui|text-to-\w+|codex|cursor|vibe[- ]coding)\b/i;

// AI repos a web developer has no use for: media generation, robotics, trading bots.
const NOT_DEV = /\b(comfyui|stable[- ]diffusion|text-to-(?:image|video|speech)|image[- ]generation|video[- ]generation|short[- ]videos?|tts|voice[- ]clon\w*|face[- ]?swap|robot\w*|lerobot|humanoids?|trading|stocks?|crypto\w*)\b/i;
const forDevs = (r) => !NOT_DEV.test(`${r.name.replace(/[/_-]/g, ' ')} ${r.description} ${(r.topics ?? []).join(' ')}`);

const num = (s) => (s ? Number(s.replace(/,/g, '')) : 0);

async function scrapeTrending(lang, since) {
  const html = await fetchText(`https://github.com/trending${lang ? `/${lang}` : ''}?since=${since}`);
  return [...html.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)]
    .map(([, a]) => {
      const name = a.match(/<h2[\s\S]*?href="\/([^"]+)"/)?.[1];
      return {
        name,
        description: plainText(a.match(/<p class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
        language: plainText(a.match(/itemprop="programmingLanguage">([^<]*)</)?.[1] ?? ''),
        stars: num(a.match(/href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/)?.[1]),
        forks: num(a.match(/href="\/[^"]+\/forks"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/)?.[1]),
        gained: num(a.match(/([\d,]+) stars? (?:today|this week|this month)/)?.[1]),
      };
    })
    .filter((r) => r.name);
}

// New repos (last 30 days) about AI, ranked by stars. Uses GITHUB_TOKEN when set;
// unauthenticated search allows only a handful of calls per minute per IP.
async function searchRising() {
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const headers = { 'user-agent': UA, accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const found = new Map();
  for (const topic of ['llm', 'ai-agents', 'mcp', 'generative-ai', 'ai']) {
    const q = encodeURIComponent(`topic:${topic} created:>${since}`);
    const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=12`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GitHub search HTTP ${res.status}`);
    for (const r of (await res.json()).items ?? []) {
      found.set(r.full_name, {
        name: r.full_name,
        description: truncate((r.description ?? '').replace(/\s+/g, ' '), 240),
        language: r.language ?? '',
        stars: r.stargazers_count,
        forks: r.forks_count,
        topics: r.topics ?? [],
        created: r.created_at,
        url: r.html_url,
      });
    }
  }
  return [...found.values()].sort((a, b) => b.stars - a.stars).slice(0, 20);
}

export const getRepos = cached(60 * 60e3, async () => {
  const pages = [
    ['', 'weekly'], ['python', 'weekly'], ['typescript', 'weekly'], ['jupyter-notebook', 'weekly'], ['', 'daily'],
  ];
  const results = await Promise.allSettled(pages.map(([lang, since]) => scrapeTrending(lang, since)));
  const byName = new Map();
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const since = pages[i][1];
    for (const repo of r.value) {
      const cur = byName.get(repo.name) ?? { ...repo, week: 0, today: 0 };
      cur[since === 'daily' ? 'today' : 'week'] = Math.max(cur[since === 'daily' ? 'today' : 'week'], repo.gained);
      cur.stars = Math.max(cur.stars, repo.stars);
      byName.set(repo.name, cur);
    }
  });
  if (!byName.size) throw new Error('Không đọc được GitHub Trending');

  const trending = [...byName.values()]
    .filter((r) => AI_REPO.test(`${r.name.replace(/[/_-]/g, ' ')} ${r.description}`) && forDevs(r))
    .map(({ gained, ...r }) => ({ ...r, description: truncate(r.description, 240), url: `https://github.com/${r.name}` }))
    .sort((a, b) => b.week - a.week || b.today - a.today)
    .slice(0, 30);

  let rising = [];
  let risingError = null;
  try {
    rising = (await searchRising()).filter((r) => forDevs(r) && !trending.some((t) => t.name === r.name));
  } catch (err) {
    risingError = err.message;
  }

  const vi = await translate([...trending, ...rising].map((r) => r.description));
  for (const r of [...trending, ...rising]) r.descriptionVi = vi(r.description);

  return { generatedAt: new Date().toISOString(), trending, rising, risingError };
});
