// Flashcard review (Leitner boxes) and the study-habit tracker of the "Học AI" tab.
// Loaded before app.js: nothing here runs until app.js calls initStudy(), so the
// helpers it uses ($, setHTML, icon, esc, currentLevel…) exist by then.

// Days until the next review for each box. Box 0 = forgotten, due again today.
const BOX_DAYS = [0, 1, 3, 7, 16, 35];
const KNOWN_BOX = 3; // 7 days or more between reviews counts as "đã thuộc"
const NEW_PER_SESSION = 10;
const CARD_MINS = 1 / 3; // rough time to answer one card
const HEAT_WEEKS = 12;
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function readStore(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// Local calendar day as a number, so "ngày mai" flips at the reader's midnight.
const dayNum = (d = new Date()) => Math.floor((d.getTime() - d.getTimezoneOffset() * 6e4) / 864e5);
const dayDate = (n) => {
  const d = new Date(n * 864e5);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

let cardState = readStore('cardState', {}); // card id -> [box, due day]
let studyLog = readStore('studyLog', {}); // day -> [lessons passed, cards rated, minutes]
let studyGoal = readStore('studyGoal', 5); // study days wanted per 7 days
let learnView = readStore('learnView', 'lessons');
let fc = null; // the open review session

const cardOf = (id) => CARDS.find((c) => c.id === id);
const deckCards = (n) => CARDS.filter((c) => c.tier === n);
const isDue = (c) => cardState[c.id] && cardState[c.id][1] <= dayNum();
const dueCards = (list = CARDS) => list.filter(isDue);
const newCards = (list = CARDS) => list.filter((c) => !cardState[c.id]);
const knownCards = (list = CARDS) => list.filter((c) => (cardState[c.id]?.[0] ?? -1) >= KNOWN_BOX);
const dueCount = () => dueCards().length;
// The deck that matches the lesson level you are on.
const suggestedDeck = () => ({ 1: 1, 2: 1, 3: 2 })[currentLevel().n] ?? 3;
const inDays = (d) => (d === 0 ? 'ôn lại ngay' : d === 1 ? 'ngày mai' : `${d} ngày nữa`);
const plural = (n, word) => `${nf0.format(n)} ${word}`;

// ---------- review session ----------

// Order: cards due today (most overdue first), then up to 10 new ones.
function reviewQueue(list) {
  const due = dueCards(list).sort((a, c) => cardState[a.id][1] - cardState[c.id][1] || cardState[a.id][0] - cardState[c.id][0]);
  return [...due, ...newCards(list).slice(0, NEW_PER_SESSION)].map((c) => c.id);
}

function startReview({ deck, lesson, card, due, extra } = {}) {
  let ids;
  let title;
  if (card) {
    ids = [card];
    title = 'Một thẻ';
  } else if (lesson) {
    ids = CARDS.filter((c) => c.lesson === lesson).map((c) => c.id);
    title = `Bài: ${lessonOf(lesson).title}`;
  } else if (due) {
    ids = reviewQueue(CARDS).filter((id) => cardState[id]);
    title = 'Thẻ đến hạn';
  } else {
    const list = deckCards(deck);
    ids = extra ? list.map((c) => c.id).sort(() => Math.random() - 0.5).slice(0, NEW_PER_SESSION) : reviewQueue(list);
    title = DECKS[deck - 1].title;
  }
  if (!ids.length) return;
  fc = { deck, lesson, title, queue: ids, pos: 0, total: ids.length, done: 0, flipped: false, seen: new Set(), firstOk: 0, missed: new Set(), finished: false };
  if (location.hash.slice(1) !== 'hoc-ai') goTab('hoc-ai');
  setLearnView('cards');
  $('#learn-views')?.scrollIntoView({ block: 'start' });
}

// Grade 0 = chưa nhớ, 1 = nhớ, 2 = dễ. A new card starts at box 1 (nhớ) or 3 (dễ).
function nextBox(id, grade) {
  if (grade === 0) return 0;
  const s = cardState[id];
  if (!s) return grade === 2 ? 3 : 1;
  return Math.min(BOX_DAYS.length - 1, s[0] + grade);
}

function flipCard() {
  if (!fc || fc.finished || fc.flipped) return;
  fc.flipped = true;
  const card = $('#fc-card');
  card?.classList.add('flipped');
  card?.querySelector('.fc-front')?.setAttribute('aria-hidden', 'true');
  card?.querySelector('.fc-back')?.removeAttribute('aria-hidden');
  $('#fc-flip')?.setAttribute('hidden', '');
  $('#fc-rate')?.removeAttribute('hidden');
}

function rateCard(grade) {
  if (!fc || !fc.flipped) return;
  const id = fc.queue[fc.pos];
  const box = nextBox(id, grade);
  cardState[id] = [box, dayNum() + BOX_DAYS[box]];
  writeStore('cardState', cardState);
  logStudy(0, 1, CARD_MINS);
  if (!fc.seen.has(id)) {
    fc.seen.add(id);
    if (grade) fc.firstOk++;
  }
  if (grade === 0) {
    fc.missed.add(id);
    // Show it again a few cards later in this session.
    fc.queue.splice(Math.min(fc.pos + 4, fc.queue.length), 0, id);
  } else {
    fc.done++;
  }
  fc.pos++;
  fc.flipped = false;
  if (fc.pos >= fc.queue.length) fc.finished = true;
  renderCards();
  refreshStudy();
}

// ---------- habit log ----------

function logStudy(lessons, cards, mins) {
  const k = dayNum();
  const row = studyLog[k] ?? [0, 0, 0];
  row[0] += lessons;
  row[1] += cards;
  row[2] = Math.round((row[2] + mins) * 100) / 100;
  studyLog[k] = row;
  writeStore('studyLog', studyLog);
}

const minsOn = (k) => studyLog[k]?.[2] ?? 0;
const studiedOn = (k) => minsOn(k) > 0;

function sumDays(from, to) {
  const out = { days: 0, lessons: 0, cards: 0, mins: 0 };
  for (let k = from; k <= to; k++) {
    const row = studyLog[k];
    if (!row || !row[2]) continue;
    out.days++;
    out.lessons += row[0];
    out.cards += row[1];
    out.mins += row[2];
  }
  return out;
}

// Today still counts as "in the streak" until midnight even before you study.
function streak() {
  let d = studiedOn(dayNum()) ? dayNum() : dayNum() - 1;
  let n = 0;
  while (studiedOn(d)) { n++; d--; }
  return n;
}

function bestStreak() {
  const days = Object.keys(studyLog).map(Number).filter(studiedOn).sort((a, c) => a - c);
  let best = 0;
  let run = 0;
  days.forEach((d, i) => {
    run = i && d === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

const lastStudyDay = () => Math.max(-Infinity, ...Object.keys(studyLog).map(Number).filter(studiedOn));

// A blunt verdict on the last 7 days against the goal.
function habitVerdict() {
  const today = dayNum();
  const last = lastStudyDay();
  const due = dueCount();
  if (last === -Infinity) {
    return { tone: 'new', title: 'Chưa có ngày học nào', text: 'Học một bài hoặc ôn vài thẻ, trang sẽ bắt đầu ghi lại thói quen của bạn.' };
  }
  const gap = today - last;
  const week = sumDays(today - 6, today).days;
  const dueText = due ? ` Có ${plural(due, 'thẻ')} đang chờ, ôn khoảng ${Math.max(1, Math.round(due * CARD_MINS))} phút là xong.` : '';
  if (gap >= 3) {
    return { tone: 'bad', title: `Đang lười: ${gap} ngày chưa học`, text: `Không ôn thì kiến thức nguội rất nhanh.${dueText || ' Mở một bài 2 phút là quay lại nhịp.'}` };
  }
  const todayText = gap === 0 ? 'Hôm nay đã học.' : gap === 1 ? `Hôm nay chưa học: học chút để giữ chuỗi ${streak()} ngày.` : 'Hôm qua và hôm nay đều chưa học.';
  if (week >= studyGoal) {
    return { tone: 'good', title: 'Chăm chỉ', text: `Bạn học ${week}/7 ngày qua, đạt mục tiêu ${studyGoal} ngày. ${todayText}` };
  }
  if (week >= Math.ceil(studyGoal / 2)) {
    return { tone: 'ok', title: 'Khá đều, cố thêm chút', text: `Học ${week}/7 ngày qua, còn thiếu ${studyGoal - week} ngày so với mục tiêu. ${todayText}` };
  }
  return { tone: 'warn', title: 'Hơi lười', text: `Mới học ${week}/7 ngày qua trong khi mục tiêu là ${studyGoal}. ${todayText}${dueText}` };
}

// ---------- rendering ----------

function setLearnView(view) {
  if (!['lessons', 'cards', 'habit'].includes(view)) view = 'lessons';
  learnView = view;
  writeStore('learnView', view);
  for (const b of $$('[data-learn-view]')) {
    if (b.closest('#learn-views')) b.setAttribute('aria-pressed', String(b.dataset.learnView === view));
  }
  for (const p of $$('[data-learn-pane]')) p.hidden = p.dataset.learnPane !== view;
  if (view === 'cards') renderCards();
  if (view === 'habit') renderHabit();
}

function renderLearnTabs() {
  const due = dueCount();
  const s = streak();
  setCount('learn-lessons', `${learnDone.size}/${LESSONS.length}`);
  setCount('learn-cards', due || '');
  setCount('learn-habit', s ? `${s} ngày` : '');
}

function deckHTML(d) {
  const list = deckCards(d.n);
  const known = knownCards(list).length;
  const fresh = newCards(list).length;
  const learning = list.length - known - fresh;
  const due = dueCards(list).length;
  const next = due + Math.min(fresh, NEW_PER_SESSION);
  const mine = d.n === suggestedDeck();
  // Segments sit on the "new" track; each keeps a 2px gap from what follows it.
  const segs = [['k', known], ['l', learning]].filter(([, n]) => n);
  const bar = segs.map(([cls, n], i) => `<i class="${cls}${i < segs.length - 1 || fresh ? ' gap' : ''}" style="width:${(n / list.length) * 100}%"></i>`).join('');
  return `<article class="deck${mine ? ' mine' : ''}">
    <header class="deck-head"><h3>${esc(d.title)}</h3>${mine ? '<span class="tag badge">Hợp với bạn</span>' : ''}<span class="deck-n">${list.length} thẻ</span></header>
    <p class="deck-goal">${esc(d.goal)}</p>
    <div class="deck-bar" role="img" aria-label="Đã thuộc ${known}, đang học ${learning}, mới ${fresh}">${bar}</div>
    <ul class="deck-legend"><li><i class="k"></i>Đã thuộc <b>${known}</b></li><li><i class="l"></i>Đang học <b>${learning}</b></li><li><i class="n"></i>Mới <b>${fresh}</b></li></ul>
    <footer class="deck-foot">
      <span class="deck-due${due ? ' on' : ''}">${due ? `${icon('clock')}${due} thẻ đến hạn` : known === list.length ? `${icon('check')}Đã thuộc cả bộ` : 'Không có thẻ đến hạn'}</span>
      ${next ? `<button type="button" class="btn${mine || due ? ' primary' : ''}" data-fc-deck="${d.n}">${icon('play')}Ôn ${next} thẻ</button>` : `<button type="button" class="btn" data-fc-deck="${d.n}" data-fc-extra>${icon('shuffle')}Ôn thêm ${NEW_PER_SESSION} thẻ</button>`}
    </footer>
  </article>`;
}

function deckHome() {
  const due = dueCount();
  const known = knownCards().length;
  return `<div class="fc-summary">
      <div class="fc-stat"><b>${due}</b><small>Thẻ đến hạn hôm nay</small></div>
      <div class="fc-stat"><b>${known}<span>/${CARDS.length}</span></b><small>Thẻ đã thuộc</small></div>
      <div class="fc-stat"><b>${streak()}</b><small>Ngày học liên tiếp</small></div>
      ${due ? `<button type="button" class="btn primary" data-fc-due>${icon('play')}Ôn ${due} thẻ đến hạn</button>` : ''}
    </div>
    <div class="decks">${DECKS.map(deckHTML).join('')}</div>
    <p class="fc-how">${icon('bulb')}<span><b>Cách ôn:</b> đọc câu hỏi, tự trả lời trong đầu, lật thẻ rồi tự chấm. Thẻ nhớ được sẽ quay lại sau 1, 3, 7, 16 rồi 35 ngày; thẻ chưa nhớ quay lại ngay trong phiên. Ôn đúng hẹn là cách nhớ lâu mà tốn ít thời gian nhất. Tiến độ lưu trong trình duyệt này.</span></p>`;
}

function sessionHTML() {
  const id = fc.queue[fc.pos];
  const c = cardOf(id);
  const deck = DECKS[c.tier - 1];
  const lesson = c.lesson && lessonOf(c.lesson);
  const again = fc.missed.has(id);
  const label = (g) => inDays(BOX_DAYS[nextBox(id, g)]);
  return `<div class="fc-session">
    <div class="fc-head">
      <b>${esc(fc.title)}</b>
      <span class="fc-pos">Thẻ ${Math.min(fc.done + 1, fc.total)}/${fc.total}</span>
      <button type="button" class="linkbtn" data-fc-quit>${icon('x')}Dừng</button>
    </div>
    <div class="lv-bar"><i style="width:${(fc.done / fc.total) * 100}%"></i></div>
    <div class="fc-stage">
      <div class="fc" id="fc-card" data-fc-card>
        <div class="fc-face fc-front">
          <div class="fc-tags"><span class="tag">${esc(deck.title)}</span><span class="tag">${esc(c.topic)}</span>${again ? '<span class="tag again">Ôn lại</span>' : ''}</div>
          <p class="fc-q">${esc(c.q)}</p>
          <span class="fc-hint">Tự trả lời trong đầu, rồi bấm vào thẻ để lật</span>
        </div>
        <div class="fc-face fc-back" aria-hidden="true">
          <p class="fc-q-small">${esc(c.q)}</p>
          <div class="fc-a">${c.a}</div>
          ${c.ex ? `<p class="fc-ex">${icon('bulb')}<span>${c.ex}</span></p>` : ''}
          ${lesson ? `<button type="button" class="linkbtn fc-lesson" data-open-lesson="${lesson.id}">Học kỹ hơn: ${esc(lesson.title)} ${icon('arrow')}</button>` : ''}
        </div>
      </div>
    </div>
    <button type="button" class="btn primary wide fc-flip" id="fc-flip" data-fc-flip>Lật thẻ <kbd>Space</kbd></button>
    <div class="fc-rate" id="fc-rate" hidden>
      <button type="button" class="rate again" data-rate="0"><b>Chưa nhớ</b><small>${label(0)}</small><kbd>1</kbd></button>
      <button type="button" class="rate good" data-rate="1"><b>Nhớ</b><small>${label(1)}</small><kbd>2</kbd></button>
      <button type="button" class="rate easy" data-rate="2"><b>Dễ</b><small>${label(2)}</small><kbd>3</kbd></button>
    </div>
  </div>`;
}

function doneHTML() {
  const today = dayNum();
  const upcoming = Object.values(cardState).map((s) => s[1]).filter((d) => d > today);
  const nextDay = upcoming.length ? Math.min(...upcoming) : null;
  const nextN = upcoming.filter((d) => d === nextDay).length;
  const more = fc.deck ? reviewQueue(deckCards(fc.deck)).length : 0;
  return `<div class="fc-done">
    <span class="fc-done-icon">${icon('check')}</span>
    <h3>Xong phiên ôn!</h3>
    <p>Bạn đã ôn ${fc.seen.size} thẻ: nhớ ngay ${fc.firstOk}${fc.missed.size ? `, phải ôn lại ${fc.missed.size}` : ''}.</p>
    ${nextDay !== null ? `<p class="fc-next">${icon('clock')}Lần ôn tới: ${inDays(nextDay - today)}, ${plural(nextN, 'thẻ')}.</p>` : ''}
    <div class="fc-done-actions">
      ${more ? `<button type="button" class="btn primary" data-fc-deck="${fc.deck}">${icon('play')}Ôn tiếp ${more} thẻ</button>` : ''}
      <button type="button" class="btn" data-fc-home>Về bộ thẻ</button>
    </div>
  </div>`;
}

function renderCards() {
  const host = $('#cards-pane');
  if (!host || learnView !== 'cards') return;
  host.innerHTML = !fc ? deckHome() : fc.finished ? doneHTML() : sessionHTML();
}

function heatLevel(m) {
  if (!m) return 0;
  return m < 5 ? 1 : m < 10 ? 2 : m < 20 ? 3 : 4;
}

function heatmapHTML() {
  const today = dayNum();
  const monday = today - ((dayDate(today).getDay() + 6) % 7);
  const start = monday - (HEAT_WEEKS - 1) * 7;
  const months = [];
  const cells = [];
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const first = dayDate(start + w * 7);
    const prev = w ? dayDate(start + (w - 1) * 7) : null;
    months.push(`<span>${!prev || prev.getMonth() !== first.getMonth() ? `Th${first.getMonth() + 1}` : ''}</span>`);
    for (let r = 0; r < 7; r++) {
      const k = start + w * 7 + r;
      if (k > today) { cells.push('<i class="hc future"></i>'); continue; }
      const row = studyLog[k] ?? [0, 0, 0];
      const d = dayDate(k);
      const when = `${WEEKDAYS[d.getDay()]}, ${d.getDate()}/${d.getMonth() + 1}`;
      const what = row[2] ? [row[0] && `${row[0]} bài`, row[1] && `${row[1]} lượt ôn thẻ`].filter(Boolean).join(', ') + ` · khoảng ${Math.max(1, Math.round(row[2]))} phút` : 'Không học';
      cells.push(`<i class="hc l${heatLevel(row[2])}${k === today ? ' today' : ''}" data-heat="${esc(`<b>${when}</b><br>${what}`)}" aria-label="${esc(`${when}: ${what}`)}" role="img"></i>`);
    }
  }
  return `<div class="heat">
    <div class="heat-months">${months.join('')}</div>
    <div class="heat-days"><span>T2</span><span></span><span>T4</span><span></span><span>T6</span><span></span><span></span></div>
    <div class="heat-grid">${cells.join('')}</div>
    <div class="heat-legend">Ít<i class="hc l0"></i><i class="hc l1"></i><i class="hc l2"></i><i class="hc l3"></i><i class="hc l4"></i>Nhiều <span>· phút học mỗi ngày, ước tính</span></div>
  </div>`;
}

function renderHabit() {
  const host = $('#habit-pane');
  if (!host || learnView !== 'habit') return;
  const today = dayNum();
  const v = habitVerdict();
  const week = sumDays(today - 6, today);
  const prev = sumDays(today - 13, today - 7);
  const month = sumDays(today - 29, today);
  const toneIcon = { good: 'check', ok: 'trend', warn: 'clock', bad: 'clock', new: 'play' }[v.tone];
  const diff = week.days - prev.days;
  host.innerHTML = `<div class="verdict ${v.tone}">
      <span class="verdict-icon">${icon(toneIcon)}</span>
      <div><h2>${esc(v.title)}</h2><p>${esc(v.text)}</p></div>
      <button type="button" class="btn primary" ${dueCount() ? 'data-fc-due' : 'data-learn-view="cards"'}>${icon('play')}${dueCount() ? `Ôn ${dueCount()} thẻ đến hạn` : 'Ôn thẻ ngay'}</button>
    </div>
    <div class="habit-kpis">
      <div class="habit-kpi"><small>Chuỗi ngày học</small><b>${icon('flame')}${streak()} ngày</b><span>Dài nhất: ${bestStreak()} ngày</span></div>
      <div class="habit-kpi"><small>7 ngày qua</small><b>${week.days}/7 ngày</b><span>Mục tiêu ${studyGoal} · 7 ngày trước đó: ${prev.days}${diff ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}</span></div>
      <div class="habit-kpi"><small>30 ngày qua</small><b>~${Math.round(month.mins)} phút</b><span>${month.lessons} bài · ${month.cards} lượt ôn thẻ</span></div>
      <div class="habit-kpi"><small>Thẻ đã thuộc</small><b>${knownCards().length}/${CARDS.length}</b><span>${learnDone.size}/${LESSONS.length} bài đã qua</span></div>
    </div>
    <section class="panel habit-panel">
      <header class="panel-head"><h2>12 tuần gần đây</h2>
        <div class="goal"><span>Mục tiêu mỗi tuần</span><div class="seg" role="group" aria-label="Số ngày học mỗi tuần">${[3, 5, 7].map((g) => `<button type="button" data-goal="${g}" aria-pressed="${g === studyGoal}">${g} ngày</button>`).join('')}</div></div>
      </header>
      <div class="goal-bar"><div class="lv-bar"><i style="width:${Math.min(100, (week.days / studyGoal) * 100)}%"></i></div><span>${week.days} ngày có học trong 7 ngày qua · mục tiêu ${studyGoal} ngày</span></div>
      ${heatmapHTML()}
      <p class="habit-note">Một ngày được tính là “có học” khi bạn qua một bài hoặc ôn ít nhất một thẻ. Thời gian là ước tính: số phút của bài, cộng khoảng 20 giây mỗi lượt ôn thẻ. Dữ liệu chỉ nằm trong trình duyệt này.</p>
    </section>`;
}

// Sidebar level card: one line on how the habit is going.
function renderHabitBadge() {
  const el = $('#lv-habit');
  if (!el) return;
  const s = streak();
  const last = lastStudyDay();
  const gap = dayNum() - last;
  el.innerHTML = last === -Infinity ? '' : gap >= 3 ? `${icon('clock')}${gap} ngày chưa học` : `${icon('flame')}${s ? `${s} ngày liên tiếp` : 'Hôm nay chưa học'}`;
  el.classList.toggle('cold', last !== -Infinity && gap >= 2);
}

// Overview banner: cards due come first; once the path is done, point at the decks.
function studyBanner(next) {
  const due = dueCount();
  if (!due && (next || !newCards().length)) return '';
  const s = streak();
  const lead = due
    ? { b: `Có ${due} thẻ đến hạn ôn hôm nay`, small: `Khoảng ${Math.max(1, Math.round(due * CARD_MINS))} phút. Ôn đúng hẹn là nhớ lâu${s ? ` · chuỗi ${s} ngày` : ''}.`, go: 'Ôn ngay', attr: 'data-fc-due' }
    : { b: `Củng cố kiến thức: ${CARDS.length} thẻ ôn tập 3 cấp`, small: 'Bạn đã đi hết lộ trình. Ôn thẻ Cơ bản, Trung bình, Nâng cao để nhớ lâu.', go: 'Ôn thẻ', attr: 'data-learn-view="cards"' };
  return `<button type="button" class="learn-banner" ${lead.attr}>
    <span class="lb-icon">${icon(due ? 'copy' : 'grad')}</span>
    <span class="lb-text"><b>${esc(lead.b)}</b><small>${esc(lead.small)}</small></span>
    <span class="lb-go">${lead.go} ${icon('arrow')}</span>
  </button>`;
}

// "Ôn N thẻ của bài này" under a lesson, shown once the quiz is passed.
function lessonCardsButton(l, done) {
  const n = CARDS.filter((c) => c.lesson === l.id).length;
  return n ? `<button type="button" class="btn lesson-cards" data-fc-lesson="${l.id}"${done ? '' : ' hidden'}>${icon('copy')}Ôn ${n} thẻ của bài này</button>` : '';
}

// Everything that shows a count after a card is rated or a lesson is passed.
function refreshStudy() {
  renderLevelBadge();
  renderLearnBanner();
  renderLearnTabs();
  if (learnView === 'habit') renderHabit();
}

function initStudy() {
  for (const id of Object.keys(cardState)) if (!cardOf(id)) delete cardState[id];
  renderLearnTabs();
  renderHabitBadge();
  setLearnView(learnView);
  document.addEventListener('click', (e) => {
    const t = e.target;
    const view = t.closest('[data-learn-view]');
    if (view) {
      if (location.hash.slice(1) !== 'hoc-ai') goTab('hoc-ai');
      setLearnView(view.dataset.learnView);
      return;
    }
    if (t.closest('[data-fc-due]')) return startReview({ due: true });
    const deck = t.closest('[data-fc-deck]');
    if (deck) return startReview({ deck: Number(deck.dataset.fcDeck), extra: deck.hasAttribute('data-fc-extra') });
    const lesson = t.closest('[data-fc-lesson]');
    if (lesson) return startReview({ lesson: lesson.dataset.fcLesson });
    if (t.closest('[data-fc-flip]') || (t.closest('[data-fc-card]') && !t.closest('button'))) return flipCard();
    const rate = t.closest('[data-rate]');
    if (rate) return rateCard(Number(rate.dataset.rate));
    if (t.closest('[data-fc-quit]')) { fc = fc?.seen.size ? { ...fc, finished: true } : null; return renderCards(); }
    if (t.closest('[data-fc-home]')) { fc = null; return renderCards(); }
    const goal = t.closest('[data-goal]');
    if (goal) {
      studyGoal = Number(goal.dataset.goal);
      writeStore('studyGoal', studyGoal);
      renderHabit();
    }
  });
  const pane = $('#habit-pane');
  pane?.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('[data-heat]');
    if (!cell) return hideTip();
    const r = cell.getBoundingClientRect();
    showTip(cell.dataset.heat, r.left + r.width / 2, r.top);
  });
  pane?.addEventListener('mouseleave', hideTip);
  addEventListener('keydown', (e) => {
    if (!fc || fc.finished || learnView !== 'cards' || location.hash.slice(1) !== 'hoc-ai') return;
    const el = e.target instanceof Element ? e.target : document.body;
    if (e.ctrlKey || e.metaKey || e.altKey || !$('#palette').hidden || el.closest('input, textarea, select, [contenteditable]')) return;
    if ((e.key === ' ' || e.key === 'Enter') && !fc.flipped && !el.closest('button, a')) {
      e.preventDefault();
      flipCard();
    } else if (fc.flipped && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      rateCard(Number(e.key) - 1);
    }
  });
}
