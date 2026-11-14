import { cached, fetchJSON, truncate } from './util.js';

// Papers the research community is upvoting today (Hugging Face Daily Papers).
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
    .sort((a, b) => b.upvotes - a.upvotes);
  return { generatedAt: new Date().toISOString(), papers };
});
