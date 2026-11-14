import { inflateRawSync } from 'node:zlib';
import { cached, fetchBuffer } from './util.js';

const ZIP_URL = 'https://epoch.ai/data/benchmark_data.zip';
const DAY = 86400e3;

// Benchmarks that show where the frontier is, described for a general reader.
// kind 'pct' = share of tasks solved (0..1); 'minutes' = METR time horizon: how long a
// task (measured in expert time) can be before AI only completes it half the time.
const BENCHES = [
  {
    file: 'gpqa_diamond.csv', col: 'mean_score', kind: 'pct', name: 'GPQA Diamond',
    title: 'Khoa học cấp tiến sĩ',
    desc: 'Câu hỏi vật lý, hóa học, sinh học khó tới mức người ngoài ngành tra Google cũng khó trả lời.',
    caption: 'số câu AI trả lời đúng',
  },
  {
    file: 'frontiermath_tiers_1_3_v2.csv', col: 'mean_score', kind: 'pct', name: 'FrontierMath (mức 1–3)',
    title: 'Toán học khó',
    desc: 'Bài toán mới do các nhà toán học soạn riêng, chưa từng được công bố.',
    caption: 'số bài AI giải đúng',
  },
  {
    file: 'frontiermath_tier_4_v2.csv', col: 'mean_score', kind: 'pct', name: 'FrontierMath (mức 4)',
    title: 'Toán cấp nghiên cứu',
    desc: 'Nhóm bài khó nhất của FrontierMath, ở mức các nhà toán học chuyên nghiệp nghiên cứu.',
    caption: 'số bài AI giải đúng',
  },
  {
    file: 'swe_bench_verified.csv', col: 'mean_score', kind: 'pct', name: 'SWE-bench Verified',
    title: 'Sửa lỗi phần mềm',
    desc: 'Lỗi thật lấy từ các dự án phần mềm mã nguồn mở; AI phải tự đọc code và sửa.',
    caption: 'số lỗi AI sửa được',
  },
  {
    file: 'terminalbench_external.csv', col: 'Accuracy mean', kind: 'pct', name: 'Terminal-Bench',
    title: 'Tự làm việc trên máy tính',
    desc: 'AI tự gõ lệnh trên máy tính để hoàn thành nhiệm vụ, không có người hướng dẫn.',
    caption: 'số nhiệm vụ AI làm xong',
  },
  {
    file: 'metr_time_horizons_external.csv', col: 'Time horizon', kind: 'minutes', name: 'METR Time Horizon',
    title: 'Tự làm được việc dài bao lâu',
    desc: 'Việc mà một chuyên gia phải mất chừng này thời gian, AI tự làm xong được một nửa số lần.',
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

export const getProgress = cached(12 * 3600e3, async () => {
  const files = unzip(await fetchBuffer(ZIP_URL));
  const benchmarks = BENCHES.map((b) => {
    const read = files.get(b.file);
    return read ? summarize(b, parseCSV(read())) : null;
  }).filter(Boolean);
  return { generatedAt: new Date().toISOString(), source: 'https://epoch.ai/benchmarks', benchmarks };
});
