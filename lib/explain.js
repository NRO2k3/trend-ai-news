// Plain-Vietnamese notes for news stories and repos: what the thing is, which
// problem it solves and when a web developer would reach for it. A Gemini model
// writes them during the build (free tier, key in GEMINI_API_KEY) and also flags
// stories a web developer can't act on. Without a key, or when a call fails,
// items just go without notes and the page shows the plain summary.
import { truncate } from './util.js';

const BASE = (process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/').replace(/\/?$/, '/');
// Tried in order: a model that is rate limited or gone hands over to the next.
const MODELS = (process.env.AI_MODEL || 'gemini-3.8-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite').split(',').map((m) => m.trim());
const BATCH = 25;
const MAX_BATCHES = 4;
// Leave the build enough of its 15 minutes for everything else.
const BUDGET_MS = 5 * 60e3;
const ACTS = new Set(['try', 'read', 'know']);

const PROMPT = `Bạn biên tập tin AI cho lập trình viên web Việt Nam, nhiều người mới tìm hiểu AI. Họ không muốn bấm vào đọc rồi mới biết thứ đó là gì.
Đầu vào là mảng JSON các mục; "type" là "tin" (bài báo) hoặc "repo" (dự án GitHub). Với MỖI mục, trả về một object:
- "id": giữ nguyên id.
- "dev": true nếu dev web dùng, thử hoặc áp dụng được vào công việc: công cụ, thư viện, API, model mới, tính năng mới của công cụ họ dùng, hướng dẫn, kỹ thuật, lỗ hổng bảo mật ảnh hưởng tới họ. false nếu là chuyện kinh doanh, gọi vốn, nhân sự, lãnh đạo, kiện tụng, chính trị, chính phủ, chip, phần cứng, robot, ngành khác, tin đồn, bình luận chung chung không có gì để làm theo.
- "title": chỉ với "tin": tiêu đề tiếng Việt tự nhiên, tối đa 90 ký tự. Giữ nguyên tên riêng (sản phẩm, công ty, thư viện, model), không dịch tên.
- "what": Là gì. Một câu, tối đa 25 từ: nó thuộc loại gì (thư viện, công cụ dòng lệnh, model, tính năng, dịch vụ, bài hướng dẫn…), của ai.
- "problem": Giải bài toán gì. Một câu, tối đa 30 từ: trước đây dev gặp khó gì mà thứ này giải quyết. Để "" nếu mục không đủ thông tin.
- "use": Dùng khi nào. Một câu, tối đa 25 từ, bắt đầu bằng "Khi bạn": tình huống dev web nên thử hoặc đọc. Để "" nếu dev là false.
- "act": "try" nếu cài hoặc dùng thử được ngay, "read" nếu là hướng dẫn, kỹ thuật nên đọc, "know" nếu chỉ cần biết.
Viết tiếng Việt đơn giản như giải thích cho đồng nghiệp; gặp thuật ngữ khó thì giải thích ngắn trong ngoặc. Chỉ dựa vào thông tin trong mục và hiểu biết chắc chắn về sản phẩm nổi tiếng, không bịa. Nếu không đủ dữ kiện để điền một trường thì để "", đừng đoán.
Chỉ trả về một mảng JSON, không thêm chữ nào khác.`;

// key → note, or null for "not for web developers". Seeded from the live site so
// each build only asks about new items.
const notes = new Map();
// Models that ran out of quota or don't exist: skip them for the rest of the build.
const spent = new Set();

/** Remembers notes and verdicts found in an already-published dataset. */
export function learnNotes(value) {
  if (Array.isArray(value)) return value.forEach(learnNotes);
  if (!value || typeof value !== 'object') return;
  if (typeof value.note?.what === 'string' && (value.id || value.name)) notes.set(value.id ?? value.name, value.note);
  for (const k of value.ai?.dropped ?? []) notes.set(k, null);
  for (const v of Object.values(value)) if (v && typeof v === 'object') learnNotes(v);
}

const line = (s, max) => (typeof s === 'string' ? truncate(s.replace(/\s+/g, ' ').trim(), max) : '');

function toNote(row, type) {
  const note = {
    title: type === 'tin' ? line(row.title, 120) : '',
    what: line(row.what, 240),
    problem: line(row.problem, 280),
    use: line(row.use, 240),
    act: ACTS.has(row.act) ? row.act : 'know',
  };
  for (const k of Object.keys(note)) if (!note[k]) delete note[k];
  return note.what ? note : undefined;
}

function parseRows(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('model không trả về JSON');
  const rows = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(rows)) throw new Error('model không trả về mảng');
  return rows;
}

// Errors end up in the published JSON, so keep them short and free of request data.
async function failure(model, res) {
  let msg = '';
  try { msg = (await res.json())?.error?.message ?? ''; } catch {}
  return `${model}: HTTP ${res.status}${msg ? ` ${truncate(String(msg), 140)}` : ''}`;
}

async function ask(batch, key) {
  const input = batch.map((e, i) => ({ id: i + 1, type: e.type, source: e.source, title: e.title, text: e.text }));
  let last = '';
  for (const model of MODELS.filter((m) => !spent.has(m))) {
    const res = await fetch(`${BASE}chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: JSON.stringify(input) }] }),
      signal: AbortSignal.timeout(120e3),
    });
    if (res.status === 429 || res.status === 404 || res.status >= 500) {
      last = await failure(model, res);
      if (res.status !== 503 && res.status !== 500) spent.add(model);
      continue;
    }
    if (!res.ok) throw new Error(await failure(model, res));
    const body = await res.json();
    return { model, rows: parseRows(body.choices?.[0]?.message?.content ?? '') };
  }
  throw new Error(last || 'hết lượt gọi model');
}

/**
 * entries: [{ key, type: 'tin' | 'repo', source, title, text }], most important first.
 * Returns note(key) → note object, null (not for web devs) or undefined (no verdict
 * yet), plus a status for the published JSON.
 */
export async function explain(entries) {
  const key = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
  const todo = entries.filter((e) => !notes.has(e.key)).slice(0, BATCH * MAX_BATCHES);
  const status = { model: null, at: new Date().toISOString(), noted: 0, error: null };
  const until = Date.now() + BUDGET_MS;
  if (todo.length && !key) status.error = 'chưa có GEMINI_API_KEY';
  for (let i = 0; key && i < todo.length && Date.now() < until; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      const { model, rows } = await ask(batch, key);
      status.model = model;
      for (const row of rows) {
        const entry = batch[Number(row?.id) - 1];
        if (!entry) continue;
        if (row.dev === false) {
          notes.set(entry.key, null);
          continue;
        }
        const note = toNote(row, entry.type);
        if (note) {
          notes.set(entry.key, note);
          status.noted++;
        }
      }
    } catch (err) {
      status.error = err.message;
      break;
    }
  }
  status.waiting = entries.filter((e) => !notes.has(e.key)).length;
  if (status.error) console.error(`explain: ${status.error}`);
  return { note: (k) => notes.get(k), status };
}
