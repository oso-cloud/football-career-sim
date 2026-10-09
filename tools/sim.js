// Balance tester: plays many careers instantly and prints the odds.
// Usage (after `python3 build.py`):  node tools/sim.js [careers]    e.g. node tools/sim.js 1000
require("../src/data.js");
require("../src/engine.js");
const E = globalThis.CareerEngine;
const W = E.prepare(globalThis.CAREER_DATA);
const tierOf = (name) => (W.clubs.find((c) => c.name === name) || { tier: 9 }).tier;

// Auto-player: takes a bigger club when offered, escapes the bench, otherwise usually stays.
let r = 7;
const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
const ui = {
  spin: async () => {}, season: async () => {}, status: async () => {}, finish: async () => {},
  choose: async ({ offers, stay }) => {
    if (!stay) return 0;
    let best = -1;
    offers.forEach((o, i) => { if (o.tier < stay.club.tier && o.role !== "Bench" && (best < 0 || o.tier < offers[best].tier)) best = i; });
    if (best >= 0) return best;
    if (stay.role === "Bench") { const i = offers.findIndex((o) => o.role !== "Bench"); if (i >= 0) return i; }
    if (offers.length && rnd() < 0.15) return Math.floor(rnd() * offers.length);
    return -1;
  },
};

(async () => {
  const N = +process.argv[2] || 500;
  const out = [];
  for (let i = 0; i < N; i++) {
    const pos = E.POSITIONS[Math.floor(rnd() * E.POSITIONS.length)].id;
    out.push(await E.runCareer({ name: "P" + i, pos, continent: Math.floor(rnd() * 6), league: -1, dream: null }, W, E.hashSeed("sim-" + i), ui));
  }
  const pct = (f) => ((100 * out.filter(f).length) / N).toFixed(1).padStart(5) + "%";
  const has = (x, re) => x.trophies.some((t) => re.test(t.name)) || x.awards.some((a) => re.test(a.name));
  const senior = (x) => x.seasons.filter((s) => !s.youth);

  console.log(`\n${N} careers\n`);
  console.log("Verdicts");
  const v = {};
  out.forEach((x) => (v[x.summary.verdict] = (v[x.summary.verdict] || 0) + 1));
  Object.entries(v).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${k.padEnd(22)} ${((100 * n) / N).toFixed(1).padStart(5)}%`));
  console.log(`  average score          ${(out.reduce((s, x) => s + x.summary.score, 0) / N).toFixed(1)}`);

  console.log("\nMilestones (share of careers)");
  const rows = [
    ["Promoted at 18", (x) => x.moves.some((m) => m.type === "First team")],
    ["League title", (x) => x.summary.titles > 0],
    ["Domestic cup", (x) => has(x, /cup$/i)],
    ["Champions League", (x) => has(x, /^Champions League$/)],
    ["Ballon d'Or", (x) => x.summary.bdo > 0],
    ["Position award (any)", (x) => x.awards.some((a) => E.POS_AWARD_RE.test(a.name))],
    ["  Golden Boot (strikers)", (x) => has(x, /Golden Boot/)],
    ["  Playmaker (midfielders)", (x) => has(x, /Playmaker of the Season/)],
    ["  Defender of the Season", (x) => has(x, /Defender of the Season/)],
    ["  Golden Glove (keepers)", (x) => has(x, /Golden Glove/)],
    ["Played a World Cup", (x) => x.worldCups.length > 0],
    ["Won a World Cup", (x) => x.worldCups.some((w) => w.won)],
    ["Club legend", (x) => x.legends.length > 0],
    ["Branded a traitor", (x) => x.traitor.length > 0],
    ["Played for a tier-1 club", (x) => senior(x).some((s) => tierOf(s.club) === 1)],
    ["Became a manager", (x) => x.manager.became],
  ];
  for (const [label, f] of rows) console.log(`  ${label.padEnd(26)} ${pct(f)}`);

  console.log("\nBy continent (average score · World Cup winners)");
  for (const c of E.CONTINENTS) {
    const g = out.filter((x) => x.continent.name === c.name);
    if (g.length) console.log(`  ${c.name.padEnd(14)} ${(g.reduce((s, x) => s + x.summary.score, 0) / g.length).toFixed(1).padStart(5)}   ${((100 * g.filter((x) => x.worldCups.some((w) => w.won)).length) / g.length).toFixed(1)}%`);
  }
  console.log("\nBy position (career averages)");
  for (const role of ["ST", "MID", "DEF", "GK"]) {
    const g = out.filter((x) => x.pos.role === role);
    if (!g.length) continue;
    const avg = (f) => Math.round(g.reduce((s, x) => s + f(x), 0) / g.length);
    console.log(`  ${role.padEnd(4)} n=${String(g.length).padEnd(4)} goals ${avg((x) => x.totals.goals)}  assists ${avg((x) => x.totals.assists)}  clean sheets ${avg((x) => x.totals.cleanSheets)}  score ${avg((x) => x.summary.score)}`);
  }
  const seasons = out.flatMap(senior);
  console.log(`\nPer season: injury ${((100 * seasons.filter((s) => s.injury).length) / seasons.length).toFixed(1)}%  poor form ${((100 * seasons.filter((s) => s.form === "poor").length) / seasons.length).toFixed(1)}%  hot streak ${((100 * seasons.filter((s) => s.form === "hot").length) / seasons.length).toFixed(1)}%\n`);
})();
