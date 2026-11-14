const UA = 'Mozilla/5.0 (X11; Linux x86_64) TrendAINews/1.0';

async function request(url, ms, retries = 1) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: '*/*' },
      signal: AbortSignal.timeout(ms),
    });
  } catch (err) {
    // Network blips are common when ~20 feeds load at once; one retry clears most.
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return request(url, ms, retries - 1);
    }
    throw new Error(err.cause?.code ?? err.message);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export const fetchText = async (url, ms = 15000) => (await request(url, ms)).text();
export const fetchJSON = async (url, ms = 15000) => (await request(url, ms)).json();
export const fetchBuffer = async (url, ms = 60000) => Buffer.from(await (await request(url, ms)).arrayBuffer());

// Wraps an async loader with an in-memory TTL cache. Concurrent callers share one
// in-flight load, and a failed refresh falls back to the last good value.
export function cached(ttlMs, load) {
  let value = null;
  let at = 0;
  let pending = null;
  return ({ force = false } = {}) => {
    if (!force && value && Date.now() - at < ttlMs) return Promise.resolve(value);
    pending ??= load()
      .then((v) => { value = v; at = Date.now(); return v; })
      .catch((err) => { if (value) return value; throw err; })
      .finally(() => { pending = null; });
    return pending;
  };
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// Turns an RSS fragment (CDATA, escaped HTML, tags) into plain text.
export function plainText(s = '') {
  let t = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t);
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  return t.replace(/\s+/g, ' ').trim();
}

export function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(' ') > n * 0.6 ? cut.lastIndexOf(' ') : n).trimEnd() + '…';
}
