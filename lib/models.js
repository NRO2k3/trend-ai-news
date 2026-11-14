import { translate } from './translate.js';
import { cached, fetchJSON, truncate } from './util.js';

const DAY = 86400e3;

// New model releases, via OpenRouter's public model catalogue (no key needed).
export const getModels = cached(60 * 60e3, async () => {
  const { data } = await fetchJSON('https://openrouter.ai/api/v1/models');
  const cutoff = Date.now() / 1000 - 60 * 86400;
  const seen = new Set();
  const models = data
    .filter((m) => m.created > cutoff)
    .sort((a, b) => b.created - a.created)
    .filter((m) => {
      const base = m.id.split(':')[0];
      return !seen.has(base) && seen.add(base);
    })
    .map((m) => {
      const id = m.id.split(':')[0];
      const prompt = Number(m.pricing?.prompt);
      const completion = Number(m.pricing?.completion);
      return {
        id,
        name: m.name.replace(/\s*\((?:free|batch)\)\s*$/i, ''),
        provider: id.split('/')[0],
        created: new Date(m.created * 1000).toISOString(),
        context: m.context_length,
        // USD per 1M tokens; null when the listing has no price
        priceIn: Number.isFinite(prompt) && prompt > 0 ? prompt * 1e6 : null,
        priceOut: Number.isFinite(completion) && completion > 0 ? completion * 1e6 : null,
        free: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
        modalities: m.architecture?.input_modalities ?? [],
        description: truncate((m.description ?? '').replace(/\s+/g, ' '), 220),
        url: `https://openrouter.ai/${id}`,
      };
    });

  const vi = await translate(models.map((m) => m.description));
  for (const m of models) m.descriptionVi = vi(m.description);

  const recent = models.filter((m) => Date.now() - Date.parse(m.created) <= 30 * DAY);
  const byProvider = Object.entries(
    recent.reduce((acc, m) => ({ ...acc, [m.provider]: (acc[m.provider] ?? 0) + 1 }), {}),
  )
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count);

  return { generatedAt: new Date().toISOString(), total: data.length, last30: recent.length, byProvider, models };
});
