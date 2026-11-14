import { inflateRawSync } from 'node:zlib';
import { cached, fetchBuffer } from './util.js';

const ZIP_URL = 'https://epoch.ai/data/benchmark_data.zip';
const DAY = 86400e3;

// Benchmarks that show where the frontier is. kind 'pct' = share of tasks solved (0..1);
// 'minutes' = METR time horizon, the length of task (in expert time) AI completes at 50% success.
const BENCHES = [
  { file: 'gpqa_diamond.csv', col: 'mean_score', kind: 'pct', name: 'GPQA Diamond', desc: 'Câu hỏi khoa học cấp tiến sĩ (lý, hóa, sinh)' },
  { file: 'frontiermath_tiers_1_3_v2.csv', col: 'mean_score', kind: 'pct', name: 'FrontierMath T1–3', desc: 'Toán khó do các nhà toán học soạn riêng' },
  { file: 'frontiermath_tier_4_v2.csv', col: 'mean_score', kind: 'pct', name: 'FrontierMath T4', desc: 'Bài toán cấp độ nghiên cứu — khó nhất' },
  { file: 'swe_bench_verified.csv', col: 'mean_score', kind: 'pct', name: 'SWE-bench Verified', desc: 'Sửa lỗi thật trong dự án phần mềm mã nguồn mở' },
  { file: 'terminalbench_external.csv', col: 'Accuracy mean', kind: 'pct', name: 'Terminal-Bench', desc: 'Agent tự làm việc trên dòng lệnh (terminal)' },
  { file: 'metr_time_horizons_external.csv', col: 'Time horizon', kind: 'minutes', name: 'METR Time Horizon', desc: 'Độ dài công việc AI tự làm xong (50% thành công), tính theo thời gian chuyên gia' },
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
    desc: bench.desc,
    kind: bench.kind,
    evaluated: entries.length,
    leader: iso(leader),
    top: top.slice(0, 5).map(iso),
    yearAgo: then ? iso(then) : null,
    record: record.map(iso),
  };
}

export const getProgress = cached(12 * 3600e3, async () => {
  const files = unzip(await fetchBuffer(ZIP_URL));
  const benchmarks = BENCHES.map((b) => {
    const read = files.get(b.file);
    return read ? summarize(b, parseCSV(read())) : null;
  }).filter(Boolean);
  return { generatedAt: new Date().toISOString(), source: 'https://epoch.ai/benchmarks', benchmarks };
});
