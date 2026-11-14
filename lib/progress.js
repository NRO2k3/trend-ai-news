import { inflateRawSync } from 'node:zlib';
import { cached, fetchBuffer, fetchJSON } from './util.js';

const ZIP_URL = 'https://epoch.ai/data/benchmark_data.zip';
const PRICES_URL = 'https://openrouter.ai/api/v1/models';
const DAY = 86400e3;

// Benchmarks that show where the frontier is, described for a general reader.
// kind 'pct' = share of tasks solved (0..1); 'minutes' = METR time horizon: how long a
// task (measured in expert time) can be before AI only completes it half the time.
// What a web developer cares about: building web UI, real coding work, using the
// terminal, and how long a task AI can finish on its own.
const BENCHES = [
  {
    file: 'webdev_arena_external.csv', col: 'Arena Score', kind: 'elo', name: 'WebDev Arena', race: 'web',
    title: 'Làm web',
    desc: 'Người dùng thật đưa yêu cầu làm trang web, xem hai AI cùng làm rồi chọn bản tốt hơn.',
    caption: 'điểm xếp hạng, càng cao càng tốt',
  },
  {
    file: 'cursorbench_external.csv', col: 'Score', kind: 'pct', name: 'CursorBench', race: 'code',
    title: 'Việc lập trình thực tế',
    desc: 'Yêu cầu lập trình thật trong trình soạn code Cursor: AI tự đọc dự án, sửa nhiều file cho đạt.',
    caption: 'số việc AI làm đạt',
  },
  {
    file: 'swe_bench_verified.csv', col: 'mean_score', kind: 'pct', name: 'SWE-bench Verified',
    title: 'Sửa lỗi phần mềm',
    desc: 'Lỗi thật lấy từ các dự án phần mềm mã nguồn mở; AI phải tự đọc code và sửa.',
    caption: 'số lỗi AI sửa được',
  },
  {
    file: 'terminalbench_external.csv', col: 'Accuracy mean', kind: 'pct', name: 'Terminal-Bench', race: 'terminal',
    title: 'Tự làm việc trong terminal',
    desc: 'AI tự gõ lệnh để cài đặt, build, sửa cấu hình, chạy dịch vụ mà không có người hướng dẫn.',
    caption: 'số nhiệm vụ AI làm xong',
  },
  {
    file: 'simpleqa_verified.csv', col: 'mean_score', kind: 'pct', name: 'SimpleQA Verified', race: 'facts',
    title: 'Trả lời kiến thức',
    desc: 'Hỏi những câu kiến thức khó có đáp án rõ ràng, AI không được tra mạng: điểm cao là trả lời đúng nhiều, ít bịa.',
    caption: 'số câu trả lời đúng',
  },
  {
    file: 'metr_time_horizons_external.csv', col: 'Time horizon', kind: 'minutes', name: 'METR Time Horizon',
    title: 'Tự làm được việc dài bao lâu',
    desc: 'Việc phần mềm mà một chuyên gia mất chừng này thời gian, AI tự làm xong được một nửa số lần.',
    caption: 'thời gian chuyên gia cần cho việc đó',
  },
];

// Just enough of the ZIP format to read Epoch's archive: central directory + deflate.
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Không đọc được file zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files.set(name, () => (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
  }
  return files;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function summarize(bench, rows) {
  const best = new Map();
  for (const r of rows) {
    const score = parseFloat(r[bench.col]);
    const date = Date.parse(r['Release date']);
    if (!Number.isFinite(score) || !Number.isFinite(date)) continue;
    const model = r['Model version'].trim();
    const prev = best.get(model);
    if (!prev || score > prev.score) best.set(model, { model, org: r.Organization || '', date, score });
  }
  const entries = [...best.values()].sort((a, b) => a.date - b.date || b.score - a.score);
  if (!entries.length) return null;

  // Running record: each point is a model that beat every model released before it.
  const record = [];
  for (const e of entries) if (!record.length || e.score > record.at(-1).score) record.push(e);

  const top = [...entries].sort((a, b) => b.score - a.score || a.date - b.date);
  const leader = top[0];
  const yearAgo = Date.now() - 365 * DAY;
  const then = [...record].reverse().find((r) => r.date <= yearAgo) ?? null;
  const iso = (e) => ({ ...e, date: new Date(e.date).toISOString().slice(0, 10) });

  return {
    name: bench.name,
    title: bench.title,
    desc: bench.desc,
    caption: bench.caption,
    kind: bench.kind,
    evaluated: entries.length,
    leader: iso(leader),
    top: top.slice(0, 5).map(iso),
    yearAgo: then ? iso(then) : null,
    record: record.map(iso),
  };
}

// ---------- the model race: who leads, how fast, at what price ----------

const EFFORT = /_(max|xhigh|high|medium|low|minimal|none|unknown|\d+k)$/i;
// One key for the same model across Epoch ("claude-opus-5-5_max",
// "gpt-5.4-2026-03-05_high") and OpenRouter ("anthropic/claude-opus-5.5").
const modelKey = (s) =>
  s.toLowerCase().trim().split('/').pop()
    .replace(EFFORT, '')
    .replace(/-(together|fireworks|deepinfra|groq|baseten|novita|vertex|bedrock|azure)$/, '') // who hosted the test run
    .replace(/-(20\d{2}-?\d{2}-?\d{2}|\d{4})$/, '')
    .replace(/[-:](preview|thinking|exp|beta)$/, '')
    .replace(/[.\s]+/g, '-');
// Used only when OpenRouter doesn't list the model (it links open weights to Hugging Face).
const OPEN_NAME = /deepseek|qwen\d*(?!.*max)|kimi|glm|minimax|llama|gpt-oss|gemma|devstral|nemotron|olmo|mimo|longcat/i;
const LABS = { Anthropic: 'anthropic', OpenAI: 'openai', 'Google DeepMind': 'google', Google: 'google' };
// "gpt-5.4-2026-03-05_high" -> "GPT 5.4", for models OpenRouter doesn't list.
const pretty = (version) =>
  version.trim().replace(EFFORT, '').replace(/-(20\d{2}-?\d{2}-?\d{2})$/, '')
    .split(/[-_\s]+/)
    .map((w) => (/^(gpt|glm|oss)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
// Coding agents read far more than they write: 3 input tokens per output token.
const blend = (pin, pout) => (3 * pin + pout) / 4;

async function loadPrices() {
  try {
    const { data } = await fetchJSON(PRICES_URL);
    const byKey = new Map();
    for (const m of data) {
      if (m.id.includes(':')) continue; // :free, :batch variants
      const pin = Number(m.pricing?.prompt) * 1e6;
      const pout = Number(m.pricing?.completion) * 1e6;
      if (!(pin > 0 && pout > 0)) continue;
      const key = modelKey(m.id);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        name: m.name.replace(/^[^:]+:\s*/, ''),
        url: `https://openrouter.ai/${m.id}`,
        open: Boolean(m.hugging_face_id),
        priceIn: +pin.toFixed(3),
        priceOut: +pout.toFixed(3),
        context: m.context_length ?? null,
      });
    }
    return byKey;
  } catch {
    return new Map();
  }
}

function race(benchRows, prices) {
  const models = new Map();
  for (const { bench, rows } of benchRows) {
    for (const r of rows) {
      const version = (r['Model version'] ?? '').trim();
      const score = parseFloat(r[bench.col]);
      const date = Date.parse(r['Release date']);
      if (!version || !Number.isFinite(score) || !Number.isFinite(date)) continue;
      const key = modelKey(version);
      const price = prices.get(key);
      const m = models.get(key) ?? {
        id: key,
        name: price?.name ?? (r.Name || pretty(version)),
        org: r.Organization || '',
        open: price ? price.open : OPEN_NAME.test(key),
        date,
        ...(price ? { url: price.url, priceIn: price.priceIn, priceOut: price.priceOut, context: price.context } : {}),
        scores: {},
      };
      m.date = Math.min(m.date, date);
      const effort = version.match(EFFORT)?.[1]?.toLowerCase();
      if (!m.scores[bench.race] || score > m.scores[bench.race].v) {
        m.scores[bench.race] = { v: +score.toFixed(4), ...(effort && effort !== 'unknown' ? { effort } : {}) };
      }
      models.set(key, m);
    }
  }
  const all = [...models.values()].map((m) => ({
    ...m,
    lab: m.open ? 'open' : LABS[m.org] ?? 'other',
    blend: m.priceIn != null ? +blend(m.priceIn, m.priceOut).toFixed(3) : null,
  }));

  const benches = {};
  for (const { bench } of benchRows) {
    const k = bench.race;
    const tested = all.filter((m) => m.scores[k]).sort((a, b) => a.date - b.date);
    // Running best per lab: the line steps up only when that lab beats itself.
    const series = {};
    for (const lab of ['anthropic', 'openai', 'google', 'open']) {
      const steps = [];
      for (const m of tested.filter((x) => x.lab === lab)) {
        if (!steps.length || m.scores[k].v > steps.at(-1).v) steps.push({ date: m.date, v: m.scores[k].v, model: m.name });
      }
      series[lab] = steps.map((x) => ({ ...x, date: new Date(x.date).toISOString().slice(0, 10) }));
    }
    // How far behind open weights are: when did a closed model first reach today's best open score?
    const best = (list) => list.reduce((a, m) => (!a || m.scores[k].v > a.scores[k].v ? m : a), null);
    const open = best(tested.filter((m) => m.open));
    const closed = best(tested.filter((m) => !m.open));
    const caughtUp = open && tested.find((m) => !m.open && m.scores[k].v >= open.scores[k].v);
    const pick = (m) => m && { name: m.name, org: m.org, v: m.scores[k].v, date: new Date(m.date).toISOString().slice(0, 10) };
    benches[k] = {
      key: k,
      name: bench.name,
      title: bench.title,
      kind: bench.kind,
      caption: bench.caption,
      tested: tested.length,
      latest: tested.length ? new Date(tested.at(-1).date).toISOString().slice(0, 10) : null,
      series,
      gap: {
        open: pick(open),
        closed: pick(closed),
        // days the best open model trails the first closed model with the same score
        lagDays: open && caughtUp ? Math.max(0, Math.round((open.date - caughtUp.date) / DAY)) : null,
        caughtUpBy: pick(caughtUp),
      },
    };
  }

  // The leaderboard and price chart only list models from the last year.
  const since = Date.now() - 365 * DAY;
  return {
    benches,
    models: all
      .filter((m) => m.date >= since)
      .map((m) => ({ ...m, date: new Date(m.date).toISOString().slice(0, 10) })),
  };
}

export const getProgress = cached(12 * 3600e3, async () => {
  const [zip, prices] = await Promise.all([fetchBuffer(ZIP_URL), loadPrices()]);
  const files = unzip(zip);
  const loaded = BENCHES.map((b) => {
    const read = files.get(b.file);
    return read ? { bench: b, rows: parseCSV(read()) } : null;
  }).filter(Boolean);
  const benchmarks = loaded.map(({ bench, rows }) => summarize(bench, rows)).filter(Boolean);
  return {
    generatedAt: new Date().toISOString(),
    source: 'https://epoch.ai/benchmarks',
    benchmarks,
    race: race(loaded.filter(({ bench }) => bench.race), prices),
    pricesFrom: prices.size ? 'https://openrouter.ai/models' : null,
  };
});
