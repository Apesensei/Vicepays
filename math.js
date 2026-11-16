// Demo math for Vice Pays: 6x5 grid, 8+ of a symbol anywhere pays, winners drop away and new symbols fall in.
// A round is a list of events the front end only plays back (the shape Stake Engine uses), so this file can
// later be swapped for precomputed books without touching the screen.
// The game deals from app/books.json (tools/build-books.mjs), whose weights fix the return exactly.
// shortcut: books are seeds replayed by this file, not Engine's .jsonl.zst + CSV files;
// export those with the Engine math SDK before any real submission (.claude/reference/stake-engine-math.md).

export const COLS = 6;
export const ROWS = 5;
export const MAX_WIN = 10000; // x bet; the round stops here
export const FREE_SPINS = 15;
export const RETRIGGER_SPINS = 5;

// pays: x bet for 8-9, 10-11, 12+ of the symbol anywhere on the grid.
export const SYMBOLS = {
  H4: { name: 'Gold-Tooth Gator', weight: 10, pays: [10, 25, 50] },
  H3: { name: 'Pink Speedboat', weight: 13, pays: [2.5, 10, 25] },
  H2: { name: 'Gold Chain', weight: 15, pays: [2, 5, 15] },
  H1: { name: 'Sports Car', weight: 18, pays: [1.5, 2, 12] },
  L5: { name: 'Energy Drink', weight: 22, pays: [1, 1.5, 10] },
  L4: { name: 'Cuban Sandwich', weight: 26, pays: [0.8, 1.2, 8] },
  L3: { name: 'Burner Phone', weight: 30, pays: [0.5, 1, 5] },
  L2: { name: 'Knockoff Aviators', weight: 34, pays: [0.4, 0.9, 4] },
  L1: { name: 'Plastic Flamingo', weight: 38, pays: [0.25, 0.75, 2] },
};
// Scatter and Heat sign weights against the 206 total above, per game type.
const SPECIAL = { base: { S: 3.8, M: 1.0 }, free: { S: 2.6, M: 7.3 }, hot: { S: 2.6, M: 9 } };
// Heat sign values: [multiplier, weight]. The getaway draws from a hotter table.
export const HEAT = {
  base: [[2, 260], [3, 200], [4, 150], [5, 120], [6, 90], [8, 70], [10, 55], [12, 35], [15, 28], [20, 20], [25, 14], [50, 7], [100, 3]],
  hot: [[50, 30], [100, 70]], // only for building the rare top-end rounds (tools/build-books.mjs)
  free: [[2, 200], [3, 160], [4, 130], [5, 110], [6, 90], [8, 75], [10, 65], [12, 45], [15, 38], [20, 30], [25, 24], [50, 16], [100, 9]],
};
// Base-game modifiers: chance per spin, and what they do. The Getaway has none.
export const DRIVE_BY = 1 / 75;   // a car throws 2-5 wilds onto the grid
const DRIVE_BY_WILDS = [[2, 5], [3, 3], [4, 2], [5, 1]];
export const UPGRADE = 1 / 150;   // the commonest low symbol (5 or more on the grid) all turn into one high symbol
const UPGRADE_TO = [['H1', 7], ['H2', 3], ['H3', 1]];
export const NUDGE = 1 / 12;      // with exactly 3 police lights left, a reel drops one more in and starts the Getaway
export const PAY_SCALE = 1; // one knob to land the return; see sim.mjs

export function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rand, pairs, total) {
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) < 0) return v;
  return pairs[pairs.length - 1][0];
}
const sum = (pairs) => pairs.reduce((s, p) => s + p[1], 0);
const HEAT_TOTAL = Object.fromEntries(Object.entries(HEAT).map(([k, v]) => [k, sum(v)]));
const TABLES = Object.fromEntries(Object.entries(SPECIAL).map(([type, sp]) => {
  const pairs = [...Object.entries(SYMBOLS).map(([id, s]) => [id, s.weight]), ['S', sp.S], ['M', sp.M]];
  return [type, { pairs, total: sum(pairs) }];
}));

// A cell is a symbol id, 'S', 'W' (wild, only ever placed by the drive-by), or 'M<value>' for a Heat sign.
function draw(rand, type) {
  const id = pick(rand, TABLES[type].pairs, TABLES[type].total);
  return id === 'M' ? 'M' + pick(rand, HEAT[type], HEAT_TOTAL[type]) : id;
}

export const payFor = (id, count) => Math.round(SYMBOLS[id].pays[count >= 12 ? 2 : count >= 10 ? 1 : 0] * PAY_SCALE * 100);

// One spin: deal, pay, drop, repeat. Returns the win in hundredths of the bet before Heat, and the final board.
function spinOnce(rand, type, events, force) {
  const board = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => draw(rand, type)));
  if (force) for (const c of [0, 1, 3, 4]) board[c][Math.floor(rand() * ROWS)] = 'S'; // demo button only
  events.push({ type: 'reveal', gameType: type === 'base' ? 'base' : 'free', board: board.map((c) => [...c]) });
  const copy = () => board.map((c) => [...c]);
  if (type === 'base' && !force) {
    const u = rand();
    if (u < DRIVE_BY) {
      const open = [];
      board.forEach((col, c) => col.forEach((id, r) => SYMBOLS[id] && open.push([c, r])));
      const positions = [];
      for (let n = pick(rand, DRIVE_BY_WILDS, sum(DRIVE_BY_WILDS)); n > 0 && open.length; n--) positions.push(...open.splice(Math.floor(rand() * open.length), 1));
      for (const [c, r] of positions) board[c][r] = 'W';
      events.push({ type: 'driveBy', positions, board: copy() });
    } else if (u < DRIVE_BY + UPGRADE) {
      const lows = ['L1', 'L2', 'L3', 'L4', 'L5'].map((id) => [id, board.flat().filter((x) => x === id).length]).sort((a, b) => b[1] - a[1]);
      if (lows[0][1] >= 5) {
        const from = lows[0][0], to = pick(rand, UPGRADE_TO, sum(UPGRADE_TO)), positions = [];
        board.forEach((col, c) => col.forEach((id, r) => { if (id === from) { col[r] = to; positions.push([c, r]); } }));
        events.push({ type: 'upgrade', from, to, positions, board: copy() });
      }
    }
  }
  let win = 0;
  for (;;) {
    const at = {};
    const wilds = [];
    board.forEach((col, c) => col.forEach((id, r) => (id === 'W' ? wilds.push([c, r]) : SYMBOLS[id] && (at[id] ||= []).push([c, r]))));
    for (const id in at) at[id].push(...wilds); // a wild counts as every symbol, and is used up with the win
    const wins = Object.entries(at).filter(([, p]) => p.length >= 8).map(([symbol, positions]) => ({ symbol, count: positions.length, positions, win: payFor(symbol, positions.length) }));
    if (!wins.length) break;
    const total = wins.reduce((s, w) => s + w.win, 0);
    win += total;
    events.push({ type: 'winInfo', wins, totalWin: total, spinWin: win });
    const gone = new Set(wins.flatMap((w) => w.positions.map(([c, r]) => c * ROWS + r)));
    board.forEach((col, c) => { // survivors sink, new symbols fill from the top
      const kept = col.filter((_, r) => !gone.has(c * ROWS + r));
      board[c] = [...Array.from({ length: ROWS - kept.length }, () => draw(rand, type)), ...kept];
    });
    events.push({ type: 'tumble', removed: [...gone].map((i) => [(i / ROWS) | 0, i % ROWS]), board: board.map((c) => [...c]) });
  }
  let heat, scatters;
  const scan = () => {
    heat = []; scatters = [];
    board.forEach((col, c) => col.forEach((id, r) => {
      if (id === 'S') scatters.push([c, r]);
      else if (id[0] === 'M') heat.push([c, r, +id.slice(1)]);
    }));
  };
  scan();
  if (type === 'base' && !force && scatters.length === 3 && rand() < NUDGE) {
    const free = [...Array(COLS).keys()].filter((c) => !board[c].includes('S'));
    const col = free[Math.floor(rand() * free.length)];
    board[col] = ['S', ...board[col].slice(0, ROWS - 1)]; // the reel slips one step: no new win can form from losing a symbol
    events.push({ type: 'nudge', col, board: copy() });
    scan();
  }
  return { win, heat, scatters };
}

// One full round. Amounts are in hundredths of the bet (100 = 1x), as Engine stores them.
// `hot` forces a Getaway drawn from the hot tables; it exists so the book builder can find top-end rounds.
export function play(seed, { forceBonus = false, hot = false } = {}) {
  const rand = rng(seed);
  const events = [];
  const cap = MAX_WIN * 100;
  let total = 0;

  const base = spinOnce(rand, 'base', events, forceBonus || hot);
  if (base.win && base.heat.length) {
    const mult = base.heat.reduce((s, h) => s + h[2], 0);
    events.push({ type: 'heat', signs: base.heat, multiplier: mult, from: base.win, to: base.win * mult });
    base.win *= mult;
  }
  total = Math.min(cap, base.win);

  if (base.scatters.length >= 4 && total < cap) {
    let left = FREE_SPINS, played = 0, totalHeat = 0, bonusWin = 0;
    events.push({ type: 'freeSpinTrigger', positions: base.scatters, spins: left });
    while (left > 0 && total < cap) {
      left--; played++;
      events.push({ type: 'freeSpinUpdate', spin: played, left, totalHeat });
      const s = spinOnce(rand, hot ? 'hot' : 'free', events);
      if (s.win && s.heat.length) { // Heat banks for the whole getaway and multiplies this spin
        totalHeat += s.heat.reduce((a, h) => a + h[2], 0);
        events.push({ type: 'heat', signs: s.heat, multiplier: totalHeat, totalHeat, from: s.win, to: s.win * totalHeat });
        s.win *= totalHeat;
      }
      bonusWin = Math.min(cap - Math.min(cap, base.win), bonusWin + s.win);
      total = Math.min(cap, base.win + bonusWin);
      if (s.scatters.length >= 3 && total < cap) {
        left += RETRIGGER_SPINS;
        events.push({ type: 'retrigger', positions: s.scatters, spins: RETRIGGER_SPINS, left });
      }
    }
    events.push({ type: 'freeSpinEnd', amount: bonusWin, totalHeat, maxWin: total >= cap });
  }
  events.push({ type: 'finalWin', amount: total });
  return { id: seed, payoutMultiplier: total, bonus: base.scatters.length >= 4, events };
}

// books.json lists the ordinary rounds through a tag string; this gives every group its seed list.
export function bookGroups(b) {
  for (const g of b.groups) if (!g.seeds) { g.seeds = []; for (let i = 0; i < b.tags.length; i++) if (+b.tags[i] === g.tag) g.seeds.push(i + 1); }
  return b.groups;
}

// Picks a precomputed round from books.json by weight: u1 chooses the group, u2 the round inside it.
export function pickBook(groups, u1, u2) {
  let g = groups[0];
  for (g of groups) if ((u1 -= g.p) < 0) break;
  return { seed: g.seeds[Math.floor(u2 * g.seeds.length)], hot: !!g.hot };
}
