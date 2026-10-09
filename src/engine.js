/* Football Career Sim — career engine.
 * Pure game logic. The page supplies a `ui` object; tests supply a mock.
 * All randomness comes from one seeded generator, so a seed replays a career exactly.
 */
(function (root) {
  "use strict";

  // Rating a regular starter at each club tier is expected to have.
  const EXPECTED = { 1: 84, 2: 78, 3: 72, 4: 66, 5: 60 };
  // How strongly each club tier competes for a league title.
  const TITLE_W = { 1: 10, 2: 4, 3: 1.5, 4: 0.6, 5: 0.25 };
  const CS_BASE = { 1: 0.42, 2: 0.36, 3: 0.31, 4: 0.27, 5: 0.24 };

  // Positions: a role plus a side. Goals (g) and assists (a) are per appearance for a regular starter.
  const ROLES = [
    { id: "ST", name: "Striker", centre: { g: 0.4, a: 0.12 }, wide: { g: 0.26, a: 0.2 }, peak: [26, 29], decline: 31 },
    { id: "MID", name: "Midfielder", centre: { g: 0.1, a: 0.13 }, wide: { g: 0.14, a: 0.2 }, peak: [26, 29], decline: 31 },
    { id: "DEF", name: "Defender", centre: { g: 0.04, a: 0.02 }, wide: { g: 0.03, a: 0.11 }, peak: [26, 30], decline: 31 },
    { id: "GK", name: "Goalkeeper", keeper: true, peak: [28, 32], decline: 34 },
  ];
  const SIDES = ["Left", "Center", "Right"];
  const POSITIONS = [];
  for (const r of ROLES) {
    if (r.keeper) { POSITIONS.push({ id: "GK", role: "GK", name: "Goalkeeper", keeper: true, g: 0, a: 0, peak: r.peak, decline: r.decline }); continue; }
    for (const side of SIDES) {
      const k = side === "Center" ? r.centre : r.wide;
      POSITIONS.push({ id: `${r.id}-${side[0]}`, role: r.id, side, name: `${side} ${r.name.toLowerCase()}`.replace(/^./, (c) => c.toUpperCase()),
        g: k.g, a: k.a, peak: r.peak, decline: r.decline });
    }
  }
  // Nationality is a continent. callUp: rating needed to make a World Cup squad; wc: chance that squad wins it.
  const CONTINENTS = [
    { name: "Africa", countries: [], callUp: 74, wc: 0.03 },
    { name: "Asia", countries: ["Saudi Arabia", "Japan"], callUp: 72, wc: 0.012 },
    { name: "Australia", countries: [], callUp: 70, wc: 0.006 },
    { name: "Europe", countries: null, callUp: 80, wc: 0.12 },
    { name: "North America", countries: ["USA/Canada", "Mexico"], callUp: 73, wc: 0.025 },
    { name: "South America", countries: ["Brazil", "Argentina"], callUp: 79, wc: 0.1 },
  ];

  const EUROPE = new Set(["England", "Spain", "Italy", "Germany", "France", "Netherlands", "Portugal", "Belgium",
    "Turkey", "Scotland", "Austria", "Switzerland", "Denmark", "Greece", "Czech Republic", "Norway", "Sweden"]);
  const LATE_LEAGUES = new Set(["saudi-pro-league", "mls", "liga-mx"]);
  // Winning one of these titles gets the club promoted to the division above.
  const UPPER = { "championship": "premier-league", "league-one": "championship", "league-two": "league-one",
    "2-bundesliga": "bundesliga", "serie-b": "serie-a", "segunda-division": "la-liga", "ligue-2": "ligue-1" };
  const TOP5_IDS = ["premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1"];
  const SECOND_TIER = new Set(["championship", "2-bundesliga", "serie-b", "segunda-division", "ligue-2",
    "league-one", "league-two"]);

  // ---------- randomness ----------
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function tools(rng) {
    const rint = (a, b) => a + Math.floor(rng() * (b - a + 1));
    const chance = (p) => rng() < p;
    const pickOne = (arr) => arr[Math.floor(rng() * arr.length)];
    function weighted(items, w) {
      let s = 0;
      for (const x of items) s += w(x);
      let r = rng() * s;
      for (const x of items) { r -= w(x); if (r <= 0) return x; }
      return items[items.length - 1];
    }
    function sample(arr, n) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a.slice(0, n);
    }
    return { rint, chance, pickOne, weighted, sample };
  }

  // ---------- data ----------
  function prepare(D) {
    const leagues = D.leagues.map((l, i) => ({
      id: l[0], name: l[1], country: l[2], level: l[3], idx: i, clubs: [],
      topFlight: !SECOND_TIER.has(l[0]),
    }));
    const clubs = D.clubs.map((c, i) => {
      const club = { id: i, name: c[0], league: leagues[c[1]], tier: c[2], ac: c[3] || 0, reserve: !!c[4] };
      leagues[c[1]].clubs.push(club);
      return club;
    });
    for (const l of leagues) {
      l.titleSum = l.clubs.reduce((s, c) => s + TITLE_W[c.tier], 0);
      l.cupSum = l.clubs.reduce((s, c) => s + Math.pow(TITLE_W[c.tier], 0.6), 0);
    }

    const rivals = new Map();
    for (const [a, b] of D.rivals || []) {
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!rivals.has(clubs[x])) rivals.set(clubs[x], new Set());
        rivals.get(clubs[x]).add(clubs[y]);
      }
    }
    return { leagues, clubs, rivals, positions: POSITIONS, continents: CONTINENTS };
  }

  const tierForRating = (r) => (r >= 84 ? 1 : r >= 78 ? 2 : r >= 72 ? 3 : r >= 65 ? 4 : 5);
  const seasonLabel = (y) => `${y}–${String((y + 1) % 100).padStart(2, "0")}`;

  // Contract wage for a regular starter at each club tier, in €m per year.
  const WAGE_BASE = { 1: 9, 2: 4.5, 3: 1.6, 4: 0.55, 5: 0.15 };
  // Chance of 0, 1, 2 or 3 offers in a summer transfer window.
  const OFFER_ODDS = [0.3, 0.3, 0.26, 0.14];
  // Injury, shortest and longest lay-off in weeks.
  const INJURIES = [["Ankle sprain", 2, 5], ["Hamstring strain", 3, 5], ["Calf strain", 2, 4], ["Groin strain", 2, 5],
    ["Concussion", 2, 3], ["Knee knock", 2, 4], ["Thigh strain", 2, 5], ["Back spasm", 2, 3]];

  function baseValue(rating, age) {
    const ageF = age <= 21 ? 1.5 : age <= 24 ? 1.3 : age <= 27 ? 1.0 : age <= 30 ? 0.6 : age <= 33 ? 0.3 : 0.15;
    return Math.pow(Math.max(0, rating - 55), 2.1) * 0.09 * ageF;
  }
  function money(m) {
    if (m >= 10) return `€${Math.round(m)}m`;
    if (m >= 1) return `€${Math.round(m * 10) / 10}m`;
    return `€${Math.max(5, Math.round(m * 1000 / 5) * 5)}k`;
  }

  // ---------- the career ----------
  async function runCareer(setup, W, seed, ui) {
    const rng = makeRng(seed);
    const T = tools(rng);
    const pos = POSITIONS.find((p) => p.id === setup.pos) || POSITIONS[0];
    const continent = CONTINENTS[setup.continent] || CONTINENTS[3];
    const homeCountries = new Set(continent.countries || [...EUROPE]);
    const rec = {
      name: setup.name, pos, continent, seed, seasons: [], moves: [], trophies: [], awards: [],
      worldCups: [], totals: { apps: 0, goals: 0, assists: 0, cleanSheets: 0 },
      earnings: 0, peakValue: 0,
    };

    // --- Which league: picked, or drawn at random from the top five ---
    let startLeague = W.leagues[setup.league];
    if (!startLeague || setup.league < 0) {
      const pool = TOP5_IDS.map((id) => W.leagues.find((l) => l.id === id));
      startLeague = T.pickOne(pool);
      await ui.spin({ kind: "league", label: "Age 15 · Which league scouts you?", items: pool.map((l) => l.name), final: startLeague.name });
    }
    const academies = startLeague.clubs.filter((c) => c.ac).sort((a, b) => a.ac - b.ac);

    // --- Academy draw. A dream club, if chosen, has a 1-in-4 chance. ---
    const dreamClub = setup.dream ? academies.find((c) => c.name === setup.dream) : null;
    const dream = !!dreamClub && T.chance(0.25);
    const academy = dream ? dreamClub : T.pickOne(dreamClub ? academies.filter((c) => c !== dreamClub) : academies);
    await ui.spin({ kind: "academy", label: `Age 15 · ${startLeague.name} academies`,
      items: academies.map((c) => c.name), final: academy.name, sub: dream ? "Your dream club!" : dreamClub ? "Not your dream club this time" : "" });
    rec.dream = dream ? academy.name : null;
    rec.startLeague = startLeague.name;

    const acBonus = academy.ac <= 3 ? 3 : 1;
    const p = {
      rating: T.rint(48, 60) + acBonus,
      potential: Math.round(64 + 32 * Math.pow(rng(), 1.5)) + (academy.ac <= 3 ? 2 : 0),
      peakAge: T.rint(pos.peak[0], pos.peak[1]),
      retireAge: 37,
      peak: 0,
      boost: 0, // market value added by contracts, fades 20% a year
      injuryHit: 0,
      wage: 0,
    };
    p.potential = clamp(p.potential, p.rating + 8, 99);
    if (dream) { // the dream move lifts your ceiling and your start: built for a legendary career
      p.potential = Math.min(99, Math.max(p.potential + 6, 86));
      p.rating += 2;
    }
    p.ceiling = p.potential; // the ceiling you were born with, revealed at the end
    rec.academy = academy;
    rec.player = p;

    const startYear = (age) => 2026 + (age - 15);
    let club = academy, yearsAtClub = 0, captainOf = null, unsettled = false, age = 15;
    // injuryHit is a temporary dent in value that clears once you're fit the next season.
    const marketValue = () => { const b = baseValue(p.rating, age); return Math.max(b * 0.3, b + p.boost - p.injuryHit); };
    let pendingRoleUp = []; // club news shown at the start of next season, if you stay
    let lastForm = "normal", lastInjury = 0, lastRole = "Starter", stintStarts = 0, lastPerf = 0, lastStats = null, buzz = 0, buzzWhy = null, standing = 0, lastHot = false, hotStreak = 0, promoteTo = null;
    const base = (c) => c.orig || c; // a promoted club is a copy that points back to the original
    rec.clubSeasons = new Map(); // senior seasons played at each club (original club objects)
    rec.legends = []; rec.traitor = []; rec.extensions = 0;
    const names = (arr) => arr.length === 1 ? arr[0] : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
    rec.marketValue = marketValue;
    rec.money = money;
    rec.moves.push({ club: academy.name, league: academy.league.name, year: startYear(15), type: "Academy", age: 15 });

    function develop(age, playFactor) {
      let d;
      if (age < p.peakAge) {
        const gap = p.potential - p.rating;
        d = (gap / Math.max(1, p.peakAge - age)) * (0.7 + rng() * 0.6) * playFactor;
        d = Math.max(0, Math.round(d));
      } else if (age < pos.decline) {
        d = T.chance(0.5) ? 0 : T.chance(0.5) ? 1 : -1;
      } else if (age < pos.decline + 3) {
        d = -T.rint(0, 2);
      } else {
        d = -T.rint(1, 3);
      }
      p.rating = clamp(p.rating + d, 35, Math.max(p.potential, p.rating));
      p.peak = Math.max(p.peak, p.rating);
    }

    // --- Youth seasons: 15, 16, 17 ---
    for (age = 15; age <= 17; age++) {
      const y = startYear(age);
      const q = p.rating - 55;
      const apps = T.rint(14, 28);
      const f = clamp(1 + q * 0.03, 0.4, 1.8) * (0.7 + rng() * 0.6);
      const s = {
        season: seasonLabel(y), year: y, age, club: academy.name, league: `${academy.name} U18`, youth: true,
        role: "Academy", apps, goals: pos.keeper ? 0 : Math.round(apps * pos.g * 1.2 * f),
        assists: Math.round(apps * pos.a * 1.1 * f), cleanSheets: pos.keeper ? Math.round(apps * 0.33 * f) : 0,
        avg: clamp(6.5 + q * 0.04 + (rng() - 0.5) * 0.5, 5.8, 8.6).toFixed(1), rating: p.rating,
        trophies: [], awards: [], events: [],
      };
      if (age === 15 && dream) s.events.push(`Dream come true: joined the ${academy.name} academy`);
      if (q >= 4 && T.chance(0.3)) s.events.push("Captained the under-18s");
      if (age === 17 && p.rating >= EXPECTED[academy.tier] - 16 && T.chance(0.4)) s.events.push("Trained with the first team");
      if (T.chance(0.06)) {
        const [kind, lo, hi] = T.pickOne(INJURIES);
        const weeks = T.rint(lo, hi);
        s.injury = { kind, weeks };
        s.events.push(`${kind}: out for ${weeks < 13 ? weeks + " weeks" : "3 months"}`);
        s.apps = Math.max(1, Math.round(s.apps * (1 - (weeks / 40) * 1.1)));
      }
      rec.seasons.push(s);
      await ui.season(s, rec);
      develop(age, 1);
      await ui.status(rec, academy, age + 1);
    }

    // --- Age 18: promoted or released ---
    age = 18;
    const rel = p.rating - (EXPECTED[academy.tier] - 12);
    const options = [
      // Most academy graduates get a first-team contract; the best prospects almost always do.
      { key: "Promoted", w: clamp(0.72 + rel * 0.02, 0.55, 0.9) },
      { key: "Released", w: 1 - clamp(0.72 + rel * 0.02, 0.55, 0.9) },
    ];
    const outcome = T.weighted(options, (o) => o.w).key;
    await ui.spin({ kind: "decision", label: "Age 18 · First-team decision",
      items: options.map((o) => o.key), final: outcome });

    function clubPool(target, filter) {
      for (const d of [0, 1, -1, 2, -2]) {
        const t = target + d;
        if (t < 1 || t > 5) continue;
        const list = W.clubs.filter((c) => !c.reserve && c.tier === t && c !== base(club) && (!filter || filter(c)));
        if (list.length >= 3) return list;
      }
      return W.clubs.filter((c) => !c.reserve && c !== base(club) && (!filter || filter(c)));
    }
    function clubWeight(c) {
      let w = 1;
      if (homeCountries.has(c.league.country)) w *= 1.1; // nationality only nudges interest
      if (c.league.country === club.league.country) w *= 1.3;
      return w;
    }
    // standing: how much your current club trusts you, earned with big seasons and loyalty. It lifts your role there.
    // Trust you bring to a new club: a name from a big club, a regular role there, silverware and experience all count.
    function arrivalTrust(dest, released) {
      if (dest === club) return standing;
      let t = (dest.tier - club.tier) * 2.5 + (club.tier <= 2 ? 1.5 : 0) + Math.min(3, rec.trophies.length) * 0.7;
      if (!released) t += lastRole === "Starter" ? 2 : lastRole === "Rotation" ? 1 : 0;
      else t *= 0.5;
      if (age >= 28) t += 1;
      return clamp(t, 0, 8);
    }
    // Veterans bring experience: from 31 they are trusted more, so a decent veteran is at least a rotation player.
    const veteran = () => (age >= 31 ? Math.min(7, (age - 30) * 1.5) : 0);
    const roleAt = (c, released) => {
      const d = p.rating - EXPECTED[c.tier] + arrivalTrust(c, released) + veteran();
      return d >= -2 ? "Starter" : d >= -7 ? "Rotation" : "Bench";
    };

    function contractFor(dest, special, released) {
      const d = p.rating - EXPECTED[dest.tier];
      let wage = WAGE_BASE[dest.tier] * clamp(1 + d * 0.06, 0.4, 2.2) * (0.8 + rng() * 0.45);
      if (dest.league.id === "saudi-pro-league") wage *= 3;
      else if (LATE_LEAGUES.has(dest.league.id)) wage *= 1.4;
      if (age <= 19) wage *= 0.5;
      if (age >= 31) wage *= 1.2; // experience is paid for, on shorter deals
      // Rivals of a club you came through or played 2+ seasons for: they pay a premium, the fans won't forgive you.
      const traitorTo = [...(W.rivals.get(base(dest)) || [])]
        .filter((c) => c === academy || c === base(club) || (rec.clubSeasons.get(c) || 0) >= 2).map((c) => c.name);
      if (traitorTo.length) wage *= 1.15;
      const years = age <= 24 ? T.rint(3, 5) : age <= 29 ? T.rint(2, 5) : age <= 31 ? T.rint(1, 3) : T.rint(1, 2);
      // Stepping down to a smaller club costs market value; the contract itself adds some back.
      const drop = released || special === "Homecoming" ? 0 : Math.max(0, dest.tier - club.tier);
      const boost = wage * years * 0.3 - (drop ? marketValue() * 0.2 * drop : 0);
      const trust = arrivalTrust(dest, released);
      return { club: dest, clubName: dest.name, league: dest.league.name, tier: dest.tier, role: roleAt(dest, released), special, traitorTo, trust,
        wage, years, boost, wageText: `${money(wage)} a year`, boostText: `${boost >= 0 ? "+" : "−"}${money(Math.abs(boost))}` };
    }
    function makeOffers(n, released) {
      const offers = [], used = new Set([base(club)]);
      const lateOk = !released && age >= 31 && p.rating >= 62 && !LATE_LEAGUES.has(club.league.id);
      const homeOk = !released && age >= 29 && club !== academy && p.rating >= EXPECTED[academy.tier] - 4;
      const rivalPool = released ? [] : [...(W.rivals.get(base(club)) || [])].filter((c) => Math.abs(c.tier - tierForRating(p.rating)) <= 1);
      const rival = rivalPool.length && T.chance(0.12) ? T.pickOne(rivalPool) : null;
      for (let i = 0; i < n; i++) {
        let dest = null, special = null;
        if (i === 0 && rival) { dest = rival; special = "Rival club"; }
        else if (i === 0 && homeOk && T.chance(0.15)) { dest = academy; special = "Homecoming"; }
        else if (lateOk && T.chance(0.35)) {
          const pool = W.clubs.filter((c) => LATE_LEAGUES.has(c.league.id) && c.tier <= 4 && !used.has(c));
          dest = T.weighted(pool, (c) => (c.league.id === "saudi-pro-league" ? 2 : 1));
          special = "Big money";
        } else {
          const cur = p.rating - EXPECTED[club.tier];
          // Last season's stats decide who comes in: standout numbers attract bigger clubs, quiet ones smaller clubs.
          // Players who are getting games are judged against their current club, so careers tend to climb.
          // Back-to-back standout seasons add a lot: clubs have watched you for years.
          const pull = lastPerf + buzz * 1.6 + Math.max(0, hotStreak - 1) * 0.8;
          let up = (cur >= 2 ? 0.42 : 0.32) + pull * 0.28, down = 0.2 - pull * 0.18;
          if (lastInjury > 0) { up *= 0.8; down += 0.05; }
          up = clamp(up, 0.05, 0.85); down = clamp(down, 0.03, 0.8);
          const odds = [up, Math.max(0.1, 1 - up - down), down];
          let step = T.weighted([-1, 0, 1], (d) => odds[d + 1]);
          // Huge numbers can bring a club two levels up.
          if (step === -1 && T.chance(clamp((pull - 1) * 0.25, 0, 0.55))) step = -2;
          const level = lastRole === "Bench" ? tierForRating(p.rating) : Math.min(tierForRating(p.rating), club.tier);
          let target = level + step;
          if (released) target = Math.max(academy.tier + 1, tierForRating(p.rating) + Math.max(0, step));
          dest = T.weighted(clubPool(clamp(target, 1, 5), (c) => !used.has(c)), clubWeight);
        }
        if (!dest || used.has(dest)) continue;
        used.add(dest);
        offers.push(contractFor(dest, special, released));
      }
      return offers;
    }
    let pendingMove = null;
    function signFor(o, released) {
      const from = club;
      const fee = released ? "Free transfer" : o.club === academy ? "Homecoming" : `${money(marketValue())} fee`;
      p.boost += o.boost;
      p.wage = o.wage;
      club = o.club;
      yearsAtClub = 0;
      standing = o.trust || 0; // you arrive with the trust your record earns you
      pendingRoleUp = [];
      pendingMove = {
        type: released ? `Released by ${from.name}, signed by ${club.name}` : o.club === academy ? `Back home at ${academy.name}` : `Signed from ${from.name}`,
        fee: `${fee} · ${money(o.wage)} a year for ${o.years} year${o.years > 1 ? "s" : ""}`,
      };
      rec.moves.push({ club: club.name, league: club.league.name, year: startYear(age), type: released ? "Free transfer" : "Transfer", age, fee });
      stintStarts = 0;
      if (o.traitorTo && o.traitorTo.length) {
        pendingMove.traitor = o.traitorTo;
        rec.traitor.push({ club: club.name, to: o.traitorTo, year: startYear(age) });
        for (const l of rec.legends) {
          if (!l.revoked && o.traitorTo.includes(l.club)) { l.revoked = true; pendingMove.revoked = (pendingMove.revoked || []).concat(l.club); }
        }
      }
    }
    // Your own club rewards loyalty and form with a better contract.
    function extensionOffer(turnedDown) {
      // A hot streak or standout season makes a new deal very likely, even for a bench player.
      const ok = yearsAtClub >= 1 && (lastHot || (lastRole !== "Bench" && lastPerf > -0.6));
      const pr = ok ? 0.2 + (turnedDown ? 0.35 : 0) + (lastHot ? 0.5 : 0) + (yearsAtClub >= 3 ? 0.1 : 0) : 0;
      if (!T.chance(Math.min(0.95, pr))) return null;
      const c = contractFor(club, null, true);
      // Raises are real but capped at what this club would pay a player of your level, so wages can't spiral.
      const cap = c.wage * (lastHot ? 1.8 : 1.4);
      const wage0 = Math.max(c.wage, Math.min(cap, p.wage * (lastHot ? 1.3 + rng() * 0.4 : 1.1 + rng() * 0.3)));
      let wage2 = wage0;
      if (wage2 <= p.wage * 1.02) wage2 = Math.min(p.wage * (1.08 + rng() * 0.07), c.wage * 2.2); // small loyalty raise
      if (wage2 <= p.wage * 1.02 && lastHot) wage2 = p.wage * (1.03 + rng() * 0.04); // already top earner: an extension with a token raise
      if (wage2 <= p.wage * 1.02) return null;
      const boost = Math.min(baseValue(p.rating, age) * 0.3,
        Math.max(0, (wage2 - p.wage) * c.years * 0.3) + baseValue(p.rating, age) * (lastHot ? 0.12 : 0.05));
      const wage = wage2;
      const promise = roleAt(club) !== "Starter" && lastHot ? (roleAt(club) === "Bench" ? "Rotation" : "Starter") : null;
      return { wage, years: c.years, boost, promise, wageText: `${money(wage)} a year`, boostText: `+${money(boost)}` };
    }
    // Promotion: the club goes up a division and rewards you according to how much you contributed.
    function promotionDeal(up) {
      const c = contractFor(club, null, true);
      const contribution = clamp(0.5 + lastPerf * 0.5 + (lastRole === "Starter" ? 0.3 : lastRole === "Rotation" ? 0.1 : -0.2), 0.1, 1.6);
      const wage = Math.max(p.wage * (1.15 + contribution * 0.4), c.wage * (up.topFlight ? 1.5 : 1.2) * (0.7 + contribution * 0.4));
      const b = baseValue(p.rating, age);
      const boost = Math.min(b * 0.45, Math.max(0, (wage - p.wage) * c.years * 0.3) + b * 0.08 * (1 + contribution));
      const promise = contribution >= 0.9 ? "Starter" : contribution >= 0.5 && lastRole === "Bench" ? "Rotation" : null;
      const level = contribution >= 1.1 ? "key player" : contribution >= 0.6 ? "important player" : "squad player";
      return { wage, years: c.years, boost, promise, promotion: up.name, level,
        wageText: `${money(wage)} a year`, boostText: `+${money(boost)}` };
    }
    function promoteClub(up) {
      const maxTier = Math.max(...up.clubs.map((c) => c.tier));
      club = Object.assign({}, base(club), { league: up, tier: Math.min(club.tier, maxTier), orig: base(club) });
    }
    function signPromotion(x, prefix) {
      const from = club.league.name;
      promoteClub(W.leagues.find((l) => l.name === x.promotion));
      p.wage = x.wage; p.boost += x.boost; rec.extensions++;
      if (x.promise) standing += x.promise === "Starter" ? 4 : 5;
      pendingMove = { type: `${prefix}promoted from the ${from} to the ${x.promotion} with ${club.name}`.replace(/^./, (ch) => ch.toUpperCase()),
        fee: `New deal as a ${x.level}: ${x.wageText} for ${x.years} years · value ${x.boostText}${x.promise ? ` · promised a ${x.promise.toLowerCase()} role` : ""}` };
    }
    function signExtension(x, prefix) {
      p.wage = x.wage; p.boost += x.boost; rec.extensions++;
      if (x.promise) standing += x.promise === "Starter" ? 4 : 5; // the new deal comes with a bigger role
      pendingMove = { type: `${prefix}signed a new deal at ${club.name}`.replace(/^./, (ch) => ch.toUpperCase()),
        fee: `${x.wageText} for ${x.years} years · value ${x.boostText}${x.promise ? ` · promised a ${x.promise.toLowerCase()} role` : ""}` };
    }

    if (outcome === "Promoted") {
      const c = contractFor(academy, null);
      p.wage = c.wage; p.boost += c.boost * 0.5;
      pendingMove = { type: "Promoted to the first team", fee: `First pro contract · ${money(c.wage)} a year` };
      rec.moves.push({ club: academy.name, league: academy.league.name, year: startYear(18), type: "First team", age: 18 });
    } else {
      const offers = makeOffers(T.weighted([1, 2, 3], (k) => [0.45, 0.35, 0.2][k - 1]), true);
      const pick = await ui.choose({ label: `Age 18 · Released by ${academy.name}. Pick your next club`, offers, stay: null, value: marketValue(), rec });
      signFor(offers[Math.max(0, pick)], true);
    }
    await ui.status(rec, club, age);

    // --- Senior career ---
    let careerOver = null;
    while (!careerOver) {
      const y = startYear(age);
      const L = club.league;
      const exp = EXPECTED[club.tier];
      const diff = p.rating - exp;
      const role = roleAt(club);
      let apps = role === "Starter" ? T.rint(32, 48) : role === "Rotation" ? T.rint(16, 31) : T.rint(2, 15);
      const s = { season: seasonLabel(y), year: y, age, club: club.name, league: L.name, role,
        trophies: [], awards: [], events: [], move: pendingMove };
      pendingMove = null;
      if (!(s.move && /^Signed|^Released/.test(s.move.type))) s.events.push(...pendingRoleUp);
      pendingRoleUp = [];
      if (s.move && s.move.traitor) { s.traitor = true; s.events.push(`${names(s.move.traitor)} fans now call you a traitor`); }
      if (s.move && s.move.revoked) s.events.push(`Your legend status at ${names(s.move.revoked)} is gone`);

      // form: some seasons go wrong, some go brilliantly
      const fr = rng();
      const form = fr < 0.18 ? "poor" : fr > 0.88 ? "hot" : "normal";
      const comeback = (lastForm === "poor" || lastInjury > 0) && form !== "poor";
      lastForm = form;
      s.form = form;
      p.injuryHit = 0;
      if (form === "poor") {
        apps = Math.round(apps * (0.7 + rng() * 0.2));
        s.events.push(T.pickOne(["Poor season: lost your place in the team", "Poor season: the fans turned on you", "Poor season: couldn't find any form"]));
      } else if (form === "hot") {
        s.events.push(comeback ? "Redemption season: proved every doubter wrong" : T.pickOne(["The season of your life", "Unstoppable form all year"]));
      } else if (comeback && lastInjury > 0) {
        s.events.push("Fully fit again and back to your best");
      }

      // events
      // injuries: 2 weeks to 3 months; they hurt this season's games, value and offers only
      lastInjury = 0;
      if (T.chance(0.1)) {
        const [kind, lo, hi] = T.pickOne(INJURIES);
        const weeks = T.rint(lo, hi);
        apps = Math.max(1, Math.round(apps * (1 - (weeks / 40) * 1.1)));
        lastInjury = weeks;
        s.injury = { kind, weeks };
        s.events.push(`${kind}: out for ${weeks < 13 ? weeks + " weeks" : "3 months"}`);
      }
      if (age <= 23 && T.chance(0.07)) {
        p.potential = Math.min(99, p.potential + T.rint(2, 4)); p.ceiling = Math.max(p.ceiling, p.potential);
        p.rating = Math.min(p.potential, p.rating + 3);
        s.events.push("Breakout season: everyone knows your name");
      }
      if (age >= 22 && age <= 25 && T.chance(0.03)) { p.potential = Math.min(99, p.potential + T.rint(4, 8)); p.ceiling = Math.max(p.ceiling, p.potential); s.events.push("Late bloomer: something clicked"); }
      if (age >= 19 && age <= 21 && T.chance(0.03)) { p.potential = Math.max(p.rating + 1, p.potential - T.rint(5, 10)); s.events.push("Lost your way. The hype faded"); }
      if (captainOf !== base(club) && age >= 25 && yearsAtClub >= 3 && role === "Starter" && T.chance(0.2)) {
        captainOf = base(club); s.events.push(`Named ${club.name} captain`);
      }
      if (T.chance(0.04)) { unsettled = true; s.events.push("Fell out with the manager"); }

      // stats
      const formF = form === "poor" ? 0.6 : form === "hot" ? 1.25 : 1;
      const quality = clamp(1 + diff * 0.025, 0.5, 1.6) * (0.8 + rng() * 0.4) * formF;
      s.apps = apps;
      s.goals = pos.keeper ? 0 : Math.round(apps * pos.g * quality);
      s.assists = Math.round(apps * pos.a * quality);
      s.cleanSheets = pos.keeper ? Math.round(apps * clamp(CS_BASE[club.tier] + diff * 0.01, 0.1, 0.6)) : 0;
      s.avg = clamp(6.6 + diff * 0.06 + (form === "poor" ? -0.5 : form === "hot" ? 0.4 : 0) + (rng() - 0.5) * 0.5, 5.6, 8.9).toFixed(1);
      if (pos.g >= 0.2 && s.goals >= 15 && T.chance(0.5)) s.events.push("Scored a hat-trick in the derby");
      if (pos.keeper && s.cleanSheets >= 18 && T.chance(0.4)) s.events.push("Saved a penalty in a title decider");
      // Performance score from the season's numbers: goal involvements (or clean sheets) per game,
      // match rating and minutes. Around 0 is an ordinary season, +1 a standout one, -1 a quiet one.
      const per = Math.max(1, s.apps);
      const contrib = pos.keeper ? s.cleanSheets / per / 0.33 : (s.goals + s.assists) / per / Math.max(0.06, pos.g + pos.a);
      const raw = (+s.avg - 6.45) * 1.6 + (contrib - 0.85) * 1.2 + (s.apps >= 32 ? 0.15 : s.apps < 12 ? -0.35 : 0);
      lastPerf = clamp((raw + 0.6) * 0.45, -2, 2);
      s.perf = lastPerf;
      lastStats = pos.keeper ? `${s.cleanSheets} clean sheets` : `${s.goals} goals and ${s.assists} assists`;
      s.rating = p.rating;
      if (lastInjury) p.injuryHit = baseValue(p.rating, age) * 0.35 * (lastInjury / 13);
      if (form === "poor") p.boost -= baseValue(p.rating, age) * 0.25;
      else if (form === "hot") p.boost += baseValue(p.rating, age) * 0.2;
      s.value = marketValue();
      rec.peakValue = Math.max(rec.peakValue, s.value);
      rec.earnings += p.wage;

      // club trophies
      const boost = role === "Starter" && diff >= 3 ? 1.15 : 1;
      if (T.chance((TITLE_W[club.tier] / L.titleSum) * boost * 0.8 * (form === "poor" ? 0.6 : 1))) s.trophies.push(`${L.name} title`);
      if (T.chance((Math.pow(TITLE_W[club.tier], 0.6) / L.cupSum) * 0.8)) s.trophies.push(L.topFlight ? "Domestic cup" : "Lower-league cup");
      if (L.topFlight) {
        const t = club.tier;
        if (EUROPE.has(L.country)) {
          const ucl = t === 1 ? 0.08 : t === 2 ? (L.level === 1 ? 0.025 : 0.012) : t === 3 ? 0.003 : 0;
          if (T.chance(ucl)) s.trophies.push("Champions League");
          else {
            const uel = t === 2 ? 0.06 : t === 3 ? (L.level <= 2 ? 0.035 : 0.02) : t === 4 ? 0.005 : 0;
            if (T.chance(uel)) s.trophies.push("Europa League");
          }
        } else if (L.country === "Brazil" || L.country === "Argentina") {
          if (T.chance(t === 2 ? 0.14 : t === 3 ? 0.045 : 0.005)) s.trophies.push("Copa Libertadores");
        } else if (L.country === "Saudi Arabia" || L.country === "Japan") {
          if (T.chance(t === 2 ? 0.17 : t === 3 ? 0.04 : t === 4 ? 0.025 : 0)) s.trophies.push("AFC Champions League");
        } else if (L.country === "USA/Canada" || L.country === "Mexico") {
          if (T.chance(t === 3 ? 0.12 : t === 4 ? 0.02 : 0)) s.trophies.push("CONCACAF Champions Cup");
        }
      }
      if (role === "Bench" && s.trophies.length) s.events.push("Mostly watched the trophy wins from the bench");

      // individual awards
      if (!pos.keeper) {
        const leagueGoals = s.goals * 0.72;
        // Golden Boot: a 15+ league-goal season puts you in the race; a hot streak helps.
        if (T.chance(clamp((leagueGoals - 10) / 10, 0, 0.75) * (form === "hot" ? 1.3 : 1))) s.awards.push(`${L.name} Golden Boot`);
      } else if (s.cleanSheets >= 15 && diff >= 2 && T.chance(0.35)) s.awards.push(`${L.name} Golden Glove`);
      if (role === "Starter" && diff >= 6 && +s.avg >= 7.5 && T.chance(0.35)) s.awards.push(`${L.name} Player of the Season`);
      if (age <= 21 && role === "Starter" && diff >= 0 && T.chance(0.4)) s.awards.push("Young Player of the Year");
      if (age >= 19 && role === "Starter" && p.rating >= 89 && club.tier <= 2 && L.topFlight) {
        const b = (p.rating - 88) * 0.02 + (s.trophies.includes("Champions League") ? 0.15 : 0)
          + (s.trophies.some((t) => t.endsWith("title")) ? 0.05 : 0) + (s.goals >= 35 ? 0.08 : 0);
        if (T.chance(clamp(b, 0, 0.3))) s.awards.push("Ballon d'Or");
      }

      // loyalty milestones at the current club
      const stint = yearsAtClub + 1;
      if (role !== "Bench") stintStarts++;
      rec.clubSeasons.set(base(club), (rec.clubSeasons.get(base(club)) || 0) + 1);
      if (stint === 5 && stintStarts >= 3) s.events.push(`Five straight seasons: a fan favourite at ${club.name}`);
      if (stint === 8 && stintStarts >= 6 && !rec.legends.some((l) => l.club === club.name)) {
        rec.legends.push({ club: club.name, season: s.season });
        s.awards.push(`${club.name} legend`);
        s.events.push(`Eight straight seasons: recognised as a ${club.name} legend`);
        p.boost += baseValue(p.rating, age) * 0.15;
      }
      if (stint === 12 && stintStarts >= 9) s.events.push(`Twelve straight seasons: a one-club icon at ${club.name}`);

      // Buzz: silverware, awards and hot streaks make bigger clubs take notice. Half of it carries into the next year.
      const big = (t) => t === "Champions League" || /Libertadores|AFC Champions|CONCACAF|Europa League|World Cup/.test(t);
      let gain = 0, reason = null;
      for (const t of s.trophies) {
        const g = big(t) ? 0.7 : t.endsWith(" title") ? (L.topFlight ? 0.55 : 0.35) : t === "Domestic cup" ? 0.3 : 0.15;
        if (g > gain) reason = `winning the ${t.replace(/ title$/, "")}${t.endsWith(" title") ? " title" : ""}`;
        gain += g;
      }
      for (const a of s.awards) {
        const g = a === "Ballon d'Or" ? 1 : /Golden (Boot|Glove)|Player of the Season/.test(a) ? 0.4 : 0.15;
        if (g >= 0.4 && !reason) reason = a === "Ballon d'Or" ? "winning the Ballon d'Or" : `winning the ${a}`;
        gain += g;
      }
      if (form === "hot") { gain += 0.3; if (!reason) reason = "your hot streak"; }
      buzz = clamp(buzz * 0.5 + gain, 0, 2);
      if (UPPER[L.id] && s.trophies.includes(`${L.name} title`)) promoteTo = W.leagues.find((l) => l.id === UPPER[L.id]);
      buzzWhy = gain > 0 ? reason : null;

      // record
      rec.totals.apps += s.apps; rec.totals.goals += s.goals; rec.totals.assists += s.assists; rec.totals.cleanSheets += s.cleanSheets;
      for (const t of s.trophies) rec.trophies.push({ name: t, season: s.season, club: club.name });
      for (const a of s.awards) rec.awards.push({ name: a, season: s.season });
      rec.seasons.push(s);
      p.peak = Math.max(p.peak, p.rating);

      await ui.season(s, rec);
      if (careerOver) break;

      // Young players who don't play lose some of their ceiling.
      if (age <= 23 && role === "Bench") p.potential = Math.max(p.rating + 1, p.potential - T.rint(1, 3));
      else if (age <= 23 && role === "Rotation" && T.chance(0.5)) p.potential = Math.max(p.rating + 1, p.potential - 1);
      develop(age, (role === "Starter" ? 1 : role === "Rotation" ? 0.85 : 0.65) * (form === "poor" ? 0.7 : 1));
      yearsAtClub++;
      lastRole = role;
      lastHot = form === "hot" || lastPerf >= 0.6;
      hotStreak = lastHot ? hotStreak + 1 : 0;
      // Big seasons earn trust at your club; loyalty adds a little every year; a poor season costs some.
      let chance = 0;
      if (role === "Bench" && !lastHot && T.chance(0.25)) { chance = 3; pendingRoleUp.push("Took your chance when the squad was stretched"); }
      standing = clamp(standing + (lastHot ? 4 : 0) + chance + 1 - (form === "poor" || lastPerf <= -0.6 ? 2 : 0), 0, 14);
      const nextRole = roleAt(club);
      if (nextRole !== role && (nextRole === "Starter" || (nextRole === "Rotation" && role === "Bench"))) {
        pendingRoleUp.push(nextRole === "Starter" ? `Earned a starting place at ${club.name}` : `Broke into the ${club.name} rotation`);
      }

      // retirement
      if (age >= 41 || age >= p.retireAge || (age >= 34 && p.rating < 56 && T.chance(0.5))) {
        careerOver = `Retired at ${age}`;
        break;
      }
      age++;
      await ui.status(rec, club, age);

      // --- off-season: transfer window ---
      p.boost *= 0.8;
      let n = T.weighted([0, 1, 2, 3], (k) => OFFER_ODDS[k]);
      if (unsettled && n === 0) n = 1;
      if (buzz >= 0.5 && n < 3 && T.chance(0.45)) n++; // silverware gets your phone ringing
      if (hotStreak >= 2 && n < 3 && T.chance(0.5)) n++; // so does a run of standout seasons
      const promoDeal = promoteTo ? promotionDeal(promoteTo) : null;
      promoteTo = null;
      unsettled = false;
      if (ui.offers) ui.offers(n);
      if (n === 0) {
        if (promoDeal) signPromotion(promoDeal, "");
        else {
          const x = extensionOffer(false);
          if (x) signExtension(x, "No offers elsewhere, ");
          else pendingMove = { type: "No offers this summer" };
        }
      }
      if (n > 0) {
        const offers = makeOffers(n, false);
        if (offers.length) {
          const stay = { club, clubName: club.name, league: promoDeal ? `${club.league.name} → ${promoDeal.promotion}` : club.league.name,
            role: promoDeal && promoDeal.promise ? promoDeal.promise : roleAt(club), stay: true, raise: promoDeal || extensionOffer(true) };
          const who = offers.length === 1 ? "1 club wants" : offers.length + " clubs want";
          const why = buzzWhy ? ` after ${buzzWhy}` : hotStreak >= 2 ? ` after ${hotStreak} standout seasons in a row` : lastPerf >= 0.6 ? ` after ${lastStats}` : lastPerf <= -0.6 ? ` after a quiet season (${lastStats})`
            : lastInjury ? " despite your injury" : "";
          const pick = await ui.choose({ label: `Summer ${startYear(age)} · ${who} to sign you${why}`, offers, stay, value: marketValue(), rec });
          if (pick >= 0) signFor(offers[pick], false);
          else {
            const turned = `turned down ${offers.length === 1 ? "an offer" : offers.length + " offers"}`;
            if (stay.raise && stay.raise.promotion) signPromotion(stay.raise, `${turned}, stayed and got `);
            else if (stay.raise) signExtension(stay.raise, `${turned} and `);
            else pendingMove = { type: `${turned.replace(/^./, (ch) => ch.toUpperCase())} to stay` };
          }
          await ui.status(rec, club, age);
        }
      }
    }

    // World Cups are settled after the career: every World Cup summer you were good enough to be picked.
    for (const s of rec.seasons) {
      const wcYear = s.year + 1;
      if (s.youth || s.age < 19 || (wcYear - 2030) % 4 !== 0 || s.rating < continent.callUp) continue;
      const won = T.chance(continent.wc * clamp(1 + (s.rating - continent.callUp) * 0.03, 1, 1.6));
      rec.worldCups.push({ year: wcYear, age: s.age + 1, won });
      if (won) rec.trophies.push({ name: "World Cup", season: String(wcYear), club: continent.name });
    }

    // A better playing career makes a coaching job, and a good coaching career, more likely.
    function managerCareer() {
      const score = rec.summary.score;
      if (!T.chance(clamp(0.12 + score * 0.009, 0.12, 0.95))) {
        const role = T.pickOne(["Pundit", "Academy coach", "Club ambassador"]);
        const home = rec.summary.longestClub || academy.name;
        const line = role === "Pundit" ? "Swapped the dugout for the TV studio."
          : role === "Academy coach" ? `Went back to coach the kids at ${academy.name}.` : `Became a club ambassador at ${home}.`;
        return { became: false, role, line };
      }
      const q = clamp((score / 100) * 0.85 + 0.1 + (rng() - 0.5) * 0.4, 0.02, 1);
      const startAge = rec.endAge + T.rint(1, 4);
      const years = clamp(Math.round(3 + q * 16 + T.rint(-2, 3)), 2, 25);
      let tier = clamp(Math.round(5 - q * 2.8 + (rng() - 0.5)), 1, 5);
      const former = [...rec.clubSeasons.keys()];
      const counts = {}, stints = [];
      const add = (k) => (counts[k] = (counts[k] || 0) + 1);
      let y = 0, wins = 0, games = 0;
      while (y < years) {
        const len = Math.min(years - y, T.rint(2, 6));
        const used = new Set(stints.map((st) => st.club));
        const pastClubs = former.filter((c) => !c.reserve && Math.abs(c.tier - tier) <= 1 && !used.has(c.name));
        const pool = W.clubs.filter((c) => !c.reserve && c.tier === tier && !used.has(c.name));
        const mc = !stints.length && pastClubs.length && T.chance(0.35) ? T.pickOne(pastClubs) : T.pickOne(pool.length ? pool : W.clubs);
        let sw = 0, sg = 0, won = 0;
        for (let k = 0; k < len; k++) {
          const strength = q + (rng() - 0.5) * 0.3;
          sg += 38; sw += Math.round(38 * clamp(0.25 + strength * 0.4 + (5 - mc.tier) * 0.03, 0.15, 0.8));
          const ML = mc.league;
          if (T.chance((TITLE_W[mc.tier] / ML.titleSum) * (0.5 + q * 1.5))) { add(`${ML.name} title`); won++; }
          if (T.chance((Math.pow(TITLE_W[mc.tier], 0.6) / ML.cupSum) * (0.5 + q))) { add(ML.topFlight ? "Domestic cup" : "Lower-league cup"); won++; }
          if (ML.topFlight && EUROPE.has(ML.country) && mc.tier <= 2 && T.chance((mc.tier === 1 ? 0.06 : 0.015) * (0.5 + q * 1.5))) { add("Champions League"); won++; }
        }
        stints.push({ club: mc.name, league: mc.league.name, from: startYear(startAge + y), to: startYear(startAge + y + len), won, winPct: Math.round(100 * sw / sg) });
        wins += sw; games += sg;
        tier = clamp(tier + (sw / sg > 0.55 || won ? -1 : sw / sg < 0.38 ? 1 : 0), 1, 5);
        y += len;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const winPct = Math.round(100 * wins / games);
      const ucl = counts["Champions League"] || 0;
      let verdict, line;
      if ((ucl && total >= 8) || total >= 14) { verdict = "Legendary manager"; line = "Just as great in the dugout as on the pitch."; }
      else if (ucl || total >= 6) { verdict = "Elite manager"; line = "One of the most wanted coaches in the game."; }
      else if (total >= 1) { verdict = "Trophy-winning manager"; line = "Silverware as a player and as a coach."; }
      else if (years <= 3) { verdict = "Short-lived spell"; line = "The dugout wasn't for you."; }
      else if (winPct >= 45) { verdict = "Respected manager"; line = "Teams always played well under you."; }
      else { verdict = "Journeyman manager"; line = "Plenty of jobs, plenty of stories."; }
      const trophies = Object.entries(counts).map(([name, n]) => ({ name, n }));
      return { became: true, startAge, years, stints, trophies, total, winPct, games, verdict, line };
    }

    rec.ended = careerOver;
    rec.endAge = age;
    rec.finalValue = marketValue();
    rec.summary = summarize(rec);
    rec.manager = managerCareer();
    const next = rec.manager.became ? "Manager" : rec.manager.role;
    await ui.spin({ kind: "manager", label: "After retirement · What's next?",
      items: ["Manager", "Pundit", "Academy coach", "Club ambassador"], final: next, sub: rec.manager.became ? rec.manager.verdict : "" });
    await ui.finish(rec);
    return rec;
  }

  // ---------- verdict ----------
  function summarize(rec) {
    const count = (n) => rec.trophies.filter((t) => t.name === n).length;
    const titles = rec.trophies.filter((t) => t.name.endsWith("title")).length;
    const bdo = rec.awards.filter((a) => a.name === "Ballon d'Or").length;
    const p = rec.player;
    const legends = rec.legends.filter((l) => !l.revoked).map((l) => l.club);
    const names = (arr) => arr.length === 1 ? arr[0] : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];
    const clubStints = {};
    for (const s of rec.seasons) if (!s.youth) clubStints[s.club] = (clubStints[s.club] || 0) + 1;
    const longest = Math.max(0, ...Object.values(clubStints));
    const clubs = Object.keys(clubStints).length;
    let score = (p.peak - 55) * 1.25 + titles * 3 + count("Domestic cup") * 1.5 + count("Champions League") * 6
      + count("Europa League") * 3 + count("Copa Libertadores") * 4 + count("World Cup") * 8 + bdo * 8
      + (rec.awards.length - bdo) * 1.2 + rec.worldCups.length * 1.5 + rec.legends.filter((l) => !l.revoked).length * 4;
    score = clamp(Math.round(score), 1, 100);
    let verdict, line;
    if (bdo >= 2 || score >= 88) { verdict = "All-time great"; line = "They will talk about you for decades."; }
    else if (score >= 68 || bdo === 1) { verdict = "World class"; line = "One of the best players of your generation."; }
    else if (legends.length && score >= 35) { verdict = "Club legend"; line = `${names(legends)} fans will never forget you.`; }
    else if (score >= 45) { verdict = "Top-flight star"; line = "A name every fan recognised."; }
    else if (p.ceiling - p.peak >= 8 && p.ceiling >= 72) { verdict = "Wasted talent"; line = "The ability was there. It never came together."; }
    else if (score >= 22 && clubs >= 6) { verdict = "Journeyman"; line = "Seen a lot of dressing rooms."; }
    else if (score >= 22) { verdict = "Solid pro"; line = "A long, respectable career."; }
    else if (longest >= 12) { verdict = "One-club hero"; line = "Loyal to the end, wherever the club played."; }
    else { verdict = "Lower-league grafter"; line = "Every penny earned the hard way."; }
    const traitorTo = [...new Set(rec.traitor.flatMap((t) => t.to))];
    return { score, verdict, line, titles, bdo, clubs, longest, legends, traitorTo, longestClub: Object.keys(clubStints).find((k) => clubStints[k] === longest) };
  }

  root.CareerEngine = { prepare, runCareer, hashSeed, money, POSITIONS, ROLES, SIDES, CONTINENTS, EXPECTED, TOP5_IDS };
})(typeof window !== "undefined" ? window : globalThis);
