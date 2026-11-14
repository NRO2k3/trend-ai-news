import { translate } from './translate.js';
import { cached, fetchJSON, truncate } from './util.js';

// Research a web developer can use: coding agents, tools, retrieval, serving, security.
// The title has to say so (abstracts mention "agents" and "context" everywhere),
// unless the abstract is plainly about code or the web.
const DEV_TITLE = /\b(code|coding|coder|program(?:s|ming)?|software|swe|repositor\w*|bugs?|debug\w*|agents?|agentic|tools?|tool[- ]use|function calling|web|websites?|browser|gui|apis?|mcp|rag|retrieval|search|inference|serving|kv[- ]cache|latency|quantiz\w*|speculative decoding|memory|context|hallucinat\w*|jailbreak\w*|prompt injection|security|vulnerab\w*|terminal|computer[- ]use|sql|ui|frontend|html|documents?|ocr|scrap\w*)\b/i;
const DEV_ABSTRACT = /\b(source code|code generation|coding|software engineering|repositor(?:y|ies)|web (?:pages?|apps?|development)|websites?|browsers?|front-?end|html|sql|apis?|mcp)\b/i;
const NOT_DEV = /\b(robot\w*|embodied|driving|autonomous vehicles?|video\w*|visual|image generation|text-to-(?:image|video|3d|speech|audio)|3d|gaussian|avatars?|motion|medical|clinical|eeg|ecg|molecul\w*|protein\w*|biolog\w*|chemi\w*|physics|weather|math\w*|theorem|proofs?|games?|music|speech|quadratic|solvers?|predictive control)\b/i;

// Papers the research community is upvoting today (Hugging Face Daily Papers),
// kept only when they are about building software.
export const getPapers = cached(60 * 60e3, async () => {
  const list = await fetchJSON('https://huggingface.co/api/daily_papers?limit=60');
  const papers = list
    .map((p) => ({
      id: p.paper.id,
      title: p.paper.title.replace(/\s+/g, ' '),
      summary: truncate((p.paper.ai_summary || p.paper.summary || '').replace(/\s+/g, ' '), 240),
      upvotes: p.paper.upvotes ?? 0,
      comments: p.numComments ?? 0,
      org: p.organization?.fullname ?? p.paper.organization?.fullname ?? null,
      date: p.publishedAt,
      thumbnail: p.thumbnail ?? null,
      url: `https://huggingface.co/papers/${p.paper.id}`,
    }))
    .filter((p) => (DEV_TITLE.test(p.title) || DEV_ABSTRACT.test(p.summary)) && !NOT_DEV.test(p.title))
    .sort((a, b) => b.upvotes - a.upvotes);
  const vi = await translate(papers.flatMap((p) => [p.title, p.summary]));
  for (const p of papers) {
    p.titleVi = vi(p.title);
    p.summaryVi = vi(p.summary);
  }
  return { generatedAt: new Date().toISOString(), papers };
});
