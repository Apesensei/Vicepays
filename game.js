// Plays back the event list math.js returns. No game rules live here.
import { start, sfx, setMood, toggleMute } from './audio.js?v=13';
import { play, pickBook, bookGroups, SYMBOLS, COLS, ROWS, MAX_WIN } from './math.js';

const $ = (id) => document.getElementById(id);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, still ? 0 : ms));
const BETS = [0.2, 0.5, 1, 2.5, 5, 10, 25];
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let balance = 1000, betIndex = 3, busy = false, chain = 0, hadBonus = false;
const books = await fetch('books.json', { cache: 'no-cache' }).then((r) => r.json());
const groups = bookGroups(books);
const layout = await fetch('assets/char/layout.json', { cache: 'no-cache' }).then((r) => r.json());
const bet = () => BETS[betIndex];
const cash = (hundredths) => (hundredths / 100) * bet();

const board = $('board');
board.replaceChildren(...Array.from({ length: COLS }, () => Object.assign(document.createElement('div'), { className: 'col' })));
const cols = [...board.children];
const cellAt = (c, r) => cols[c].children[r];

function makeCell(id) {
  const el = document.createElement('div');
  el.className = 'cell';
  if (id[0] === 'M') {
    const v = +id.slice(1);
    el.classList.add('heat');
    el.dataset.tier = v >= 50 ? 2 : v >= 10 ? 1 : 0;
    el.append(Object.assign(document.createElement('b'), { textContent: v + 'x' }));
  } else {
    el.dataset.id = id;
    el.append(Object.assign(new Image(), { src: `assets/sym/${id}.webp`, alt: SYMBOLS[id]?.name ?? (id === 'W' ? 'Wild' : 'Police lights') }));
  }
  return el;
}

// Slide an element in from `rows` cells above where it now sits.
function fall(el, rows, delay = 0) {
  if (!rows || still) return Promise.resolve();
  return el.animate([{ transform: `translateY(${-rows * 100}%)` }, { transform: 'none' }],
    { duration: 260 + rows * 45, delay, easing: 'cubic-bezier(.4, 0, .3, 1.25)', fill: 'backwards' }).finished;
}

function setChain(n) {
  chain = n;
  setMood({ heat: n });
  [...$('meter').querySelectorAll('i')].forEach((pip, i) => pip.classList.toggle('on', i < n));
  $('frame').classList.toggle('siren', n >= 3 || $('stage').classList.contains('free'));
}

function banner(text, big = false) {
  const b = $('banner');
  b.hidden = !text;
  b.textContent = text;
  b.classList.toggle('big', big);
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; // replay the entrance
}

// Shows one of her clips. Reactions play once, then she goes back to the idle loop.
let poseTimer, poseCount = 0;
function pose(name) {
  if (still && name !== 'idle') return;
  const at = layout[name], idle = layout.idle, fit = at.fit ?? { s: 1, ox: idle.feetX - at.feetX, oy: idle.feetY - at.feetY }, img = new Image(); // no fit yet: match feet
  img.alt = '';
  // `fit` overlays this clip's head and torso on the idle's (tools/fit-clips.mjs); the CSS hangs it from her feet point
  img.style.cssText = `--w:${at.w * fit.s};--fx:${idle.feetX - fit.ox};--fy:${idle.feetY - fit.oy}`;
  img.onload = () => { // show the new clip over the old one and fade across, so the change of stance is not a hard cut
    const old = [...$('char').children];
    $('char').append(img);
    if (still || !old.length) return old.forEach((o) => o.remove());
    img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    setTimeout(() => old.forEach((o) => o.remove()), 160);
  };
  img.src = `assets/char/${name}.webp` + (name === 'idle' ? '' : `?n=${++poseCount}`); // a fresh address restarts a play-once clip
  clearTimeout(poseTimer);
  if (name !== 'idle') poseTimer = setTimeout(() => pose('idle'), at.ms);
}

function cheer() {
  const c = $('char');
  c.classList.remove('cheer'); void c.offsetWidth; c.classList.add('cheer');
}

async function overlay(art, text, ms, busted = false) {
  $('overlayArt').hidden = !art;
  if (art) $('overlayArt').src = `assets/ui/${art}.webp`;
  $('overlayText').textContent = text;
  $('overlay').classList.toggle('busted', busted);
  $('overlay').hidden = false;
  await wait(ms);
  $('overlay').hidden = true;
}

// ---- effects. Sprites are neon on black, shown with screen blending in the #fx layer.
const stage = $('stage');
const cq = () => $('frame').offsetWidth / 48; // one layout unit in pixels: the frame is 48 units wide in both layouts
const rnd = (a, b) => a + Math.random() * (b - a); // looks only, never outcomes
function centre(el) {
  const a = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
  return [a.left - s.left + a.width / 2, a.top - s.top + a.height / 2];
}
function fx(name, [x, y], size, frames, opts = {}) {
  if (still) return;
  const el = Object.assign(new Image(), { src: `assets/fx/${name}.webp`, className: 'glow' });
  el.style.cssText = `left:${x}px;top:${y}px;width:${size * cq()}px`;
  $('fx').append(el);
  el.animate(frames, { duration: 450, easing: 'ease-out', fill: 'both', ...opts }).finished.then(() => el.remove());
  return el;
}
const ring = (at) => fx('ring', at, 9, [{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }]);
const burst = (at, size = 13) => fx('burst', at, size, [{ transform: 'scale(.2)', opacity: 1 }, { transform: 'scale(1.3) rotate(35deg)', opacity: 0 }], { duration: 520 });
function shake(px, ms) {
  if (!still) stage.animate([{ translate: '0 0' }, { translate: `${px}px ${-px}px` }, { translate: `${-px}px ${px}px` }, { translate: '0 0' }], { duration: 60, iterations: Math.ceil(ms / 60) });
}
// Chips or bills thrown up from under the board.
function fountain(name, count, spread = 22) {
  const [bx, by] = centre($('frame')), u = cq();
  for (let i = 0; i < count; i++) {
    const dx = rnd(-spread, spread) * u, up = rnd(16, 34) * u, spin = rnd(-400, 400);
    fx(name, [bx, by + 17 * u], rnd(3.5, 6), [
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(.2, .7, .4, 1)' },
      { transform: `translate(${dx * .6}px, ${-up}px) rotate(${spin * .5}deg)`, opacity: 1, easing: 'cubic-bezier(.6, 0, .9, .5)' },
      { transform: `translate(${dx}px, ${10 * u}px) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: rnd(1000, 1700), delay: rnd(0, 500), easing: 'linear' });
  }
}
// Bills falling over the whole screen.
function rain(name, count, ms) {
  const u = cq();
  for (let i = 0; i < count; i++) {
    const spin = rnd(-300, 300);
    fx(name, [rnd(.04, .96) * stage.clientWidth, -4 * u], rnd(4, 7), [
      { transform: 'translateY(0) rotate(0deg)' }, { transform: `translate(${rnd(-6, 6) * u}px, ${stage.clientHeight + 8 * u}px) rotate(${spin}deg)` },
    ], { duration: rnd(1400, 2400), delay: rnd(0, ms), easing: 'linear' });
  }
}
// A bolt stretched from one element to another.
function bolt(from, to) {
  const [x1, y1] = centre(from), [x2, y2] = centre(to);
  const len = Math.hypot(x2 - x1, y2 - y1), turn = Math.atan2(x2 - x1, y1 - y2);
  const el = fx('bolt', [(x1 + x2) / 2, (y1 + y2) / 2], 8, [{ opacity: 0 }, { opacity: 1 }, { opacity: .35 }, { opacity: 1 }, { opacity: 0 }], { duration: 420 });
  if (el) { el.style.height = len + 'px'; el.style.rotate = turn + 'rad'; el.style.objectFit = 'fill'; }
  burst([x2, y2], 9);
}
// A picture that crosses the screen (the drive-by car, the runner). Not screen-blended: these are solid art.
function actor(src, size, y, ms) {
  if (still) return;
  const u = cq(), el = Object.assign(new Image(), { src });
  const [fx0] = centre($('frame')); // crosses from just left of the frame to just right of it
  el.style.cssText = `left:0;top:${y}px;width:${size * u}px;filter:drop-shadow(0 0 ${u}px #ff3ea5)`;
  $('fx').append(el);
  el.animate([{ transform: `translateX(${fx0 - (26 + size) * u}px)` }, { transform: `translateX(${fx0 + 26 * u}px)` }], { duration: ms, easing: 'cubic-bezier(.3, 0, .7, 1)', fill: 'both' })
    .finished.then(() => el.remove());
}
// Swaps the cells at `positions` for what the new board holds there, with a flash on each.
async function swapCells(positions, b, gap) {
  for (const [c, r] of positions) {
    const fresh = makeCell(b[c][r]);
    cellAt(c, r).replaceWith(fresh);
    burst(centre(fresh), 11);
    fresh.animate([{ transform: 'scale(1.6)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
    await wait(gap);
  }
}

function countUp(el, to, ms) {
  if (still) { el.textContent = money(to); return Promise.resolve(); }
  const t0 = performance.now();
  return new Promise((done) => (function step(t) {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = money(to * k * k * (3 - 2 * k));
    k < 1 ? requestAnimationFrame(step) : done();
  })(t0));
}

// Win tiers by total round win in bets: [from, art, hold ms, celebration].
const TIERS = [
  [100, 'tier4', 4200, () => { shake(10, 300); rain('bill', 70, 3200); fountain('chip', 40); $('frame').classList.add('siren'); fx('siren', centre($('frame')), 60, [{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 700, iterations: 5 }); }],
  [60, 'tier3', 3400, () => { shake(10, 240); rain('bill', 40, 2400); $('frame').classList.add('siren'); for (let i = 0; i < 6; i++) { const [x, y] = centre($('frame')); burst([x + rnd(-20, 20) * cq(), y + rnd(-15, 15) * cq()], 16); } }],
  [30, 'tier2', 2800, () => { shake(6, 180); fountain('bill', 16); fountain('chip', 16); }],
  [15, 'tier1', 2200, () => fountain('chip', 14)],
];
async function celebrate(tier, won) {
  const [, art, ms, party] = tier;
  stage.classList.toggle('dimmed', tier[0] >= 30);
  if (tier[0] >= 100) await wait(300); // the beat before the top banner lands
  $('tierArt').src = `assets/ui/${art}.webp`;
  $('tier').hidden = false;
  party();
  sfx.tier(TIERS.length - TIERS.indexOf(tier));
  pose(tier[0] >= 60 ? 'cash' : 'cheer');
  await Promise.all([countUp($('tierAmount'), won, Math.min(1600, ms * .5)), wait(ms)]);
  $('tier').hidden = true;
  stage.classList.remove('dimmed');
  setChain(chain); // puts the frame's siren back to what the round state says
}

const handlers = {
  async reveal({ board: b }) {
    setChain(0);
    banner('');
    board.classList.remove('dim');
    if (!still) await Promise.all(cols.flatMap((col, c) => [...col.children].map((el) =>
      el.animate([{ transform: 'none' }, { transform: `translateY(${ROWS * 110}%)` }], { duration: 170, delay: c * 25, easing: 'ease-in', fill: 'forwards' }).finished)));
    const drops = [];
    cols.forEach((col, c) => {
      col.replaceChildren(...b[c].map(makeCell));
      [...col.children].forEach((el, r) => drops.push(fall(el, ROWS + 1, c * 55 + (ROWS - 1 - r) * 28)));
    });
    await Promise.all(drops);
    sfx.land();
  },

  async driveBy({ positions, board: b }) {
    banner(`Drive-by: ${positions.length} wilds`);
    sfx.car();
    const [, fy] = centre($('frame'));
    actor('assets/fx/car.webp', 19, fy + 13.5 * cq(), 1300);
    shake(3, 180);
    await wait(350);
    await swapCells([...positions].sort((a, b2) => a[0] - b2[0]), b, 170);
    await wait(500);
  },

  async upgrade({ from, to, positions, board: b }) {
    banner(`Upgrade: ${SYMBOLS[from].name} becomes ${SYMBOLS[to].name}`);
    sfx.upgrade();
    positions.forEach(([c, r]) => cellAt(c, r).classList.add('hit'));
    const [, fy] = centre($('frame'));
    actor('assets/fx/runner.webp', 10, fy - 5 * cq(), 1000);
    await wait(450);
    await swapCells([...positions].sort((a, b2) => a[0] - b2[0]), b, 70);
    await wait(500);
  },

  // The ankle monitor glitches and one reel slips a step, dropping a fourth police light in.
  async nudge({ col, board: b }) {
    pose('worry');
    banner('Monitor glitch');
    sfx.glitch();
    $('frame').classList.add('siren');
    shake(4, 240);
    await wait(900);
    cols[col].replaceChildren(...b[col].map(makeCell));
    await Promise.all([...cols[col].children].map((el) => fall(el, 1)));
    burst(centre(cellAt(col, 0)), 16);
    await wait(500);
  },

  async winInfo({ wins, spinWin }) {
    setChain(Math.min(5, chain + 1));
    sfx.hit(chain);
    board.classList.add('dim');
    const cells = wins.flatMap((w) => w.positions.map(([c, r]) => cellAt(c, r)));
    cells.forEach((el) => el.classList.add('hit'));
    banner(`${wins.map((w) => `${w.count} × ${SYMBOLS[w.symbol].name}`).join(' + ')}  ${money(cash(spinWin))}`);
    $('win').textContent = money(cash(spinWin));
    const strong = spinWin >= 500 || chain >= 3;
    if (strong) { shake(3, 120); cheer(); }
    await wait(620);
    cells.forEach((el) => { (strong ? burst : ring)(centre(el)); el.classList.add('pop'); });
    sfx.pop();
    if (strong) fountain('chip', 5, 10);
    await wait(240);
    board.classList.remove('dim');
  },

  async tumble({ removed, board: b }) {
    const drops = [];
    cols.forEach((col, c) => {
      const gone = new Set(removed.filter(([rc]) => rc === c).map(([, r]) => r));
      if (!gone.size) return;
      const kept = [...col.children].map((el, r) => [el, r]).filter(([, r]) => !gone.has(r));
      const fresh = b[c].slice(0, gone.size).map(makeCell);
      col.replaceChildren(...fresh, ...kept.map(([el]) => el));
      fresh.forEach((el) => drops.push(fall(el, gone.size, c * 30)));
      kept.forEach(([el, oldRow], i) => drops.push(fall(el, gone.size + i - oldRow, c * 30)));
    });
    await Promise.all(drops);
    await wait(120);
  },

  async heat({ signs, multiplier, totalHeat, from, to }) {
    sfx.heat(signs.some((h) => h[2] >= 50));
    await wait(100); // hit-stop
    const target = totalHeat !== undefined ? $('totalHeat') : $('meter');
    signs.forEach(([c, r]) => { cellAt(c, r).classList.add('zap'); bolt(cellAt(c, r), target); });
    if (totalHeat !== undefined) {
      const out = $('totalHeat');
      out.textContent = totalHeat + 'x';
      out.classList.remove('bump'); void out.offsetWidth; out.classList.add('bump');
    }
    banner(`${money(cash(from))} × ${multiplier} Heat = ${money(cash(to))}`);
    $('win').textContent = money(cash(to));
    cheer();
    await wait(1100);
  },

  async freeSpinTrigger({ positions, spins }) {
    hadBonus = true;
    sfx.scatter();
    positions.forEach(([c, r]) => cellAt(c, r).classList.add('hit'));
    await wait(900);
    $('stage').classList.add('free');
    setMood({ free: true });
    sfx.siren();
    $('totalHeat').textContent = '0x';
    $('spinsLeft').textContent = spins;
    $('getaway').hidden = false;
    $('meter').hidden = true;
    await overlay('getaway', `${spins} free spins`, 2200);
  },

  freeSpinUpdate({ left }) { $('spinsLeft').textContent = left; },

  async retrigger({ positions, spins, left }) {
    positions.forEach(([c, r]) => cellAt(c, r).classList.add('hit'));
    $('spinsLeft').textContent = left;
    sfx.siren();
    await overlay('roadblock', `+${spins} free spins`, 1500);
  },

  async freeSpinEnd({ amount, totalHeat, maxWin }) {
    setMood({ free: false });
    if (!amount) { sfx.busted(); await overlay('busted', '', 2400, true); }
    else await overlay(null, `${maxWin ? `Max win ${MAX_WIN.toLocaleString()}x: ` : ''}The Getaway paid ${money(cash(amount))} at ${totalHeat}x Heat`, 2600);
    $('stage').classList.remove('free');
    $('getaway').hidden = true;
    $('meter').hidden = false;
    setChain(0);
  },

  async finalWin({ amount }) {
    const won = cash(amount);
    $('win').textContent = money(won);
    balance += won;
    // three police lights, one short of the Getaway: she checks the ankle monitor
    if (!hadBonus && board.querySelectorAll('.cell[data-id=S]').length === 3) pose('worry');
    const tier = TIERS.find(([from]) => amount >= from * 100);
    if (tier) { banner(''); await celebrate(tier, won); }
  },
};

function show() {
  $('balance').textContent = money(balance);
  $('bet').textContent = money(bet());
}

async function spin(forceBonus = false, demoSeed) {
  if (busy) return;
  if (balance < bet()) { $('note').textContent = 'Not enough balance for this bet.'; return; }
  busy = true;
  hadBonus = false;
  $('note').textContent = '';
  $('spin').classList.add('busy');
  for (const b of [$('spin'), $('force'), $('tiers'), $('events'), $('betUp'), $('betDown')]) b.disabled = true;
  balance -= bet();
  sfx.spin();
  $('win').textContent = money(0);
  show();
  // Real spins deal a precomputed round by weight; the demo button draws a forced Getaway instead.
  const book = demoSeed ? { seed: demoSeed } : forceBonus ? { seed: (Math.random() * 2 ** 32) >>> 0 } : pickBook(groups, Math.random(), Math.random());
  const round = play(book.seed, { hot: book.hot, forceBonus });
  for (const ev of round.events) await handlers[ev.type]?.(ev);
  show();
  $('spin').classList.remove('busy');
  for (const b of [$('spin'), $('force'), $('tiers'), $('events'), $('betUp'), $('betDown')]) b.disabled = false;
  busy = false;
}

// Sound can only begin after the player's first click or key press.
addEventListener('pointerdown', start, { once: true });
addEventListener('keydown', start, { once: true });
$('mute').onclick = () => { const off = toggleMute(); $('mute').setAttribute('aria-pressed', off); $('mute').textContent = off ? '×' : '♪'; };
for (const id of ['betUp', 'betDown', 'info']) $(id).addEventListener('click', () => sfx.click());
$('spin').onclick = () => spin();
$('force').onclick = () => spin(true);
// demo: plays a real round that contains the next random event (drive-by, upgrade, monitor glitch)
const EVENTS = ['driveBy', 'upgrade', 'nudge'];
let nextEvent = 0, eventSeed = 1;
$('events').onclick = () => {
  const want = EVENTS[nextEvent++ % EVENTS.length];
  while (!play(eventSeed).events.some((e) => e.type === want)) eventSeed++;
  spin(false, eventSeed++);
};
let nextTier = TIERS.length - 1; // demo: shows each win banner in turn, pays nothing
$('tiers').onclick = async () => {
  if (busy) return;
  busy = true;
  await celebrate(TIERS[nextTier], TIERS[nextTier][0] * bet());
  nextTier = (nextTier + TIERS.length - 1) % TIERS.length;
  busy = false;
};
$('betUp').onclick = () => { betIndex = Math.min(BETS.length - 1, betIndex + 1); show(); };
$('betDown').onclick = () => { betIndex = Math.max(0, betIndex - 1); show(); };
$('info').onclick = () => $('rules').showModal();
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !$('rules').open) { e.preventDefault(); spin(); }
});

$('pays').innerHTML = '<tr><th>Symbol</th><th>8-9</th><th>10-11</th><th>12+</th></tr>' + Object.entries(SYMBOLS).map(([id, s]) =>
  `<tr><td><img src="assets/sym/${id}.webp" alt="">${s.name}</td>${s.pays.map((p) => `<td>${p}x</td>`).join('')}</tr>`).join('');

// Opening board, so the screen is never empty.
cols.forEach((col, c) => col.replaceChildren(...play(7).events[0].board[c].map(makeCell)));
$('rtp').textContent = (books.target * 100).toFixed(2) + '%';
$('win').textContent = money(0);
pose('idle');
show();
