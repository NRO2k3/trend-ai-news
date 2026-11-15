// Evening review reminder: a short greeting, then three cards from public/cards.js
// (one per deck) as Telegram quiz polls. Run daily by .github/workflows/telegram.yml.
//
//   node scripts/telegram.js          send today's quiz
//   node scripts/telegram.js --dry    print what would be sent instead of sending it
//   node scripts/telegram.js --chats  list chats that wrote to the bot, to find TELEGRAM_CHAT_ID
//
// Needs TELEGRAM_BOT_TOKEN (from @BotFather) and TELEGRAM_CHAT_ID.
import { readFile } from 'node:fs/promises';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const CHAT = process.env.TELEGRAM_CHAT_ID?.trim();
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'NRO2k3/trend-ai-news').split('/');
const SITE = process.env.SITE_URL ?? `https://${owner.toLowerCase()}.github.io/${repo}/`;
const VN_OFFSET = 7 * 3600e3;
const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const DOTS = ['🟢', '🔵', '🟣']; // Cơ bản, Trung bình, Nâng cao

// cards.js is a plain browser script that declares DECKS and CARDS.
async function loadCards() {
  const src = await readFile(new URL('../public/cards.js', import.meta.url), 'utf8');
  return new Function(`${src}\nreturn { DECKS, CARDS };`)();
}

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// Shown after a wrong answer, at most 200 characters: keep whole sentences.
function explain(c) {
  const text = plain(c.a);
  if (text.length <= 200) return text;
  let out = '';
  for (const part of text.split(/(?<=[.;])\s+/)) {
    const next = out ? `${out} ${part}` : part;
    if (next.length > 200) break;
    out = next;
  }
  return out || `${text.slice(0, 199)}…`;
}

// One card per deck; each deck walks through all its cards before repeating.
function pickCards(cards, day) {
  return [1, 2, 3].map((tier) => {
    const list = cards.filter((c) => c.tier === tier);
    return list[(day + tier * 11) % list.length];
  });
}

function buildQuiz({ DECKS, CARDS }, now = new Date()) {
  const vn = new Date(now.getTime() + VN_OFFSET);
  const day = Math.floor(vn.getTime() / 864e5);
  const date = `${WEEKDAYS[vn.getUTCDay()]} ${vn.getUTCDate()}/${vn.getUTCMonth() + 1}`;
  const cards = pickCards(CARDS, day);
  const intro = `🧠 <b>Ôn AI · ${date}</b>\n<i>3 câu trắc nghiệm, khoảng 1 phút. Chọn đáp án, sai thì Telegram giải thích ngay.</i>`;
  const polls = cards.map((c, i) => {
    const buttons = [{ text: '📖 Xem thẻ đầy đủ', url: `${SITE}?the=${c.id}#hoc-ai` }];
    if (i === cards.length - 1) buttons.push({ text: '📚 Ôn thêm trên trang', url: `${SITE}?the=all#hoc-ai` });
    return {
      question: `${DOTS[c.tier - 1]} ${DECKS[c.tier - 1].title} · ${c.q}`,
      // The right answer is listed first; Telegram shuffles what the reader sees.
      options: c.mc.map((text) => ({ text })),
      type: 'quiz',
      correct_option_ids: [0],
      shuffle_options: true,
      explanation: explain(c),
      reply_markup: { inline_keyboard: [buttons] },
    };
  });
  return { intro, polls };
}

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

async function main() {
  const args = process.argv.slice(2);
  const deck = await loadCards();
  const { intro, polls } = buildQuiz(deck);
  if (args.includes('--dry')) {
    console.log(intro);
    for (const p of polls) {
      console.log(`\n${p.question}`);
      p.options.forEach((o, i) => console.log(`  ${i === 0 ? '✓' : '·'} ${o.text}`));
      console.log(`  💡 ${p.explanation}`);
      console.log(`  ${p.reply_markup.inline_keyboard[0].map((b) => `[${b.text}]`).join(' ')}`);
    }
    return;
  }
  if (!TOKEN) {
    // Not set up yet: say so in the Actions log without failing the run every evening.
    console.log('::warning::Chưa có TELEGRAM_BOT_TOKEN, bỏ qua lần nhắc này.');
    return;
  }
  if (args.includes('--chats')) {
    const seen = new Map();
    for (const u of await api('getUpdates')) {
      const chat = (u.message ?? u.my_chat_member ?? u.channel_post)?.chat;
      if (chat) seen.set(chat.id, chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username);
    }
    if (!seen.size) console.log('Chưa thấy tin nhắn nào. Mở bot trên Telegram, gửi /start rồi chạy lại.');
    for (const [id, name] of seen) console.log(`${id}\t${name}`);
    return;
  }
  if (!CHAT) {
    console.log('::warning::Chưa có TELEGRAM_CHAT_ID, bỏ qua lần nhắc này.');
    return;
  }
  await api('sendMessage', { chat_id: CHAT, text: intro, parse_mode: 'HTML' });
  // Only the greeting rings; the quizzes arrive silently right under it.
  for (const p of polls) await api('sendPoll', { chat_id: CHAT, disable_notification: true, ...p });
  console.log('Đã gửi 3 câu trắc nghiệm.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
