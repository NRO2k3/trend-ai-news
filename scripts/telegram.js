// Evening review reminder: sends three cards from public/cards.js (one per deck)
// to a Telegram chat, answers hidden as spoilers. Run daily by
// .github/workflows/telegram.yml.
//
//   node scripts/telegram.js          send today's cards
//   node scripts/telegram.js --dry    print the message instead of sending it
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

// cards.js is a plain browser script that declares DECKS and CARDS.
async function loadCards() {
  const src = await readFile(new URL('../public/cards.js', import.meta.url), 'utf8');
  return new Function(`${src}\nreturn { DECKS, CARDS };`)();
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One card per deck; each deck walks through all its cards before repeating.
function pickCards(cards, day) {
  return [1, 2, 3].map((tier) => {
    const list = cards.filter((c) => c.tier === tier);
    return list[(day + tier * 11) % list.length];
  });
}

function buildMessage({ DECKS, CARDS }, now = new Date()) {
  const vn = new Date(now.getTime() + VN_OFFSET);
  const day = Math.floor(vn.getTime() / 864e5);
  const date = `${WEEKDAYS[vn.getUTCDay()]} ${vn.getUTCDate()}/${vn.getUTCMonth() + 1}`;
  const blocks = pickCards(CARDS, day).map((c, i) => {
    const answer = c.ex ? `${c.a}\n💡 ${c.ex}` : c.a;
    return [
      `<b>${i + 1}. ${DECKS[c.tier - 1].title} · ${esc(c.topic)}</b>`,
      esc(c.q),
      `<tg-spoiler>${answer}</tg-spoiler>`,
      `<a href="${SITE}?the=${c.id}#hoc-ai">Ôn thẻ này trên trang</a>`,
    ].join('\n');
  });
  return [
    `<b>🧠 Ôn AI 2 phút · ${date}</b>`,
    'Tự trả lời trong đầu, rồi chạm vào phần bị che để xem đáp án.',
    ...blocks,
    'Ôn thêm trên trang để giữ chuỗi ngày học của bạn.',
  ].join('\n\n');
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
  const text = buildMessage(deck);
  if (args.includes('--dry')) {
    console.log(text);
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
  await api('sendMessage', {
    chat_id: CHAT,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: 'Mở thẻ ôn tập', url: `${SITE}?the=all#hoc-ai` }]] },
  });
  console.log('Đã gửi 3 thẻ ôn.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
