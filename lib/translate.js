// English → Vietnamese via the free Google Translate endpoint that browser
// extensions use. It needs no key but is unofficial, so any failure just leaves
// the original text in place (the page falls back to it).
const ENDPOINT = 'https://translate.googleapis.com/translate_a/t?client=gtx&sl=auto&tl=vi';
const MAX_CHARS = 7000;
const MAX_TEXTS = 80;
const cache = new Map();

// Machine translation picks the wrong sense for some AI terms.
const FIXES = [
  { when: /\bagent/i, from: /(đại lý|đặc vụ)/gi, to: 'tác nhân' },
  { when: /\bfrontier/i, from: /biên giới/gi, to: 'tiên tiến' },
  { when: /\bweights?\b/i, from: /trọng lượng/gi, to: 'trọng số' },
  { when: /\bprompt/i, from: /lời nhắc nhở/gi, to: 'câu lệnh' },
  { when: /\btokens?\b/i, from: /mã thông báo/gi, to: 'token' },
  { when: /\breason/i, from: /lý luận/gi, to: 'suy luận' },
];

// Package names, version strings and other short labels read worse translated.
const worthTranslating = (t) => (t.match(/\p{L}{2,}/gu) ?? []).length >= 3;

function polish(original, vi) {
  let out = vi;
  for (const f of FIXES) {
    if (!f.when.test(original)) continue;
    out = out.replace(f.from, (m) => (m[0] === m[0].toUpperCase() ? f.to[0].toUpperCase() + f.to.slice(1) : f.to));
  }
  return out;
}

// Seeds the cache from already-published data, where a field like `titleVi`
// sits next to its original `title`, so each build only translates new text.
export function learnFrom(value) {
  if (Array.isArray(value)) return value.forEach(learnFrom);
  if (!value || typeof value !== 'object') return;
  for (const [key, v] of Object.entries(value)) {
    if (key.endsWith('Vi') && typeof v === 'string' && typeof value[key.slice(0, -2)] === 'string') {
      cache.set(value[key.slice(0, -2)], v);
    } else if (v && typeof v === 'object') {
      learnFrom(v);
    }
  }
}

function batches(texts) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const t of texts) {
    if (cur.length && (size + t.length > MAX_CHARS || cur.length >= MAX_TEXTS)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(t);
    size += t.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function request(batch) {
  const body = new URLSearchParams();
  for (const t of batch) body.append('q', t);
  const res = await fetch(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const out = await res.json();
  batch.forEach((t, i) => {
    const vi = Array.isArray(out[i]) ? out[i][0] : out[i];
    if (typeof vi === 'string' && vi.trim()) cache.set(t, polish(t, vi));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The endpoint answers 502 now and then, and some batches fail on their content:
// retry once, then split the batch so one bad text can't sink the rest.
async function translateBatch(batch, budget) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (budget.failures >= 8) return;
    try {
      return await request(batch);
    } catch (err) {
      budget.failures++;
      budget.last = err.message;
      await sleep(1500 * (attempt + 1));
    }
  }
  if (batch.length > 1) {
    const mid = Math.ceil(batch.length / 2);
    await translateBatch(batch.slice(0, mid), budget);
    await translateBatch(batch.slice(mid), budget);
  }
}

async function run(texts) {
  const todo = [...new Set(texts.filter((t) => t && !cache.has(t) && worthTranslating(t)))];
  const budget = { failures: 0, last: '' };
  for (const batch of batches(todo)) await translateBatch(batch, budget);
  const missed = todo.filter((t) => !cache.has(t)).length;
  if (missed) console.error(`translate: ${missed}/${todo.length} đoạn chưa dịch được (${budget.last})`);
}

// Loaders call this concurrently; one queue keeps requests from bursting.
let queue = Promise.resolve();

/** Translates texts (cached) and returns a lookup: original → Vietnamese or null. */
export function translate(texts) {
  const job = queue.then(() => run(texts));
  queue = job.catch(() => {});
  return job.then(() => (t) => (t ? cache.get(t) ?? null : null));
}
