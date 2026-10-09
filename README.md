# Football Career Sim

A free browser game inspired by TikTok's "My Football Career" filter. Pick a name, position and starting league. Then spin through a pro career from age 15 to 37: academy, transfers, trophies, injuries, rivalries, and life after retiring.

**Play:** https://football-career-sim-gold.vercel.app

## How the project is laid out

```
index.html        ← the finished game (generated — don't edit by hand)
build.py          ← combines the files in src/ into index.html
src/
  page.html       ← layout, styles, screens, share card (the UI)
  engine.js       ← game logic: odds, seasons, offers, trophies, scoring
  clubs.json      ← 30 leagues, 564 clubs, tiers 1–5, academies
tools/
  sim.js          ← plays hundreds of careers instantly and prints the odds
```

`index.html` is one self-contained file. It holds the UI, the engine and the club data, and it's the page players load.

## Making a change

1. Edit the right file in `src/`: `page.html` for anything visual, `engine.js` for odds and rules, `clubs.json` for clubs and leagues.
2. Rebuild:
   ```
   python3 build.py
   ```
   This rewrites `index.html` (and `src/data.js`, a temporary file the build uses).
3. Open `index.html` in a browser to try it.
4. Commit `src/` **and** `index.html` together and push to `main`.

Every push to `main` auto-deploys to the live site in about 30 seconds. Vercel also runs `python3 build.py` on each deploy (see `vercel.json`), so the live site always matches `src/`. That holds even when an edit was made straight on GitHub.

If a deploy breaks something, go to the Vercel project → **Deployments**, then **Promote to Production** on the last good one.

## Checking the balance

After any odds change, run the simulator (needs Node.js):

```
python3 build.py
node tools/sim.js 1000
```

It prints the share of careers per verdict, plus how often players win the league, Champions League, Ballon d'Or, Golden Boot and World Cup. It also shows averages per position and the injury and form rates.

## Where the main knobs are in `src/engine.js`

Search the file for these names:

| What | Where to look |
|---|---|
| Club strength by tier (1 = elite … 5 = weakest) | `EXPECTED` |
| League title chances by tier | `TITLE_W`, and the line that pushes `` `${L.name} title` `` |
| Golden Boot odds | the line containing `Golden Boot` (uses league goals that season) |
| Ballon d'Or odds | the line containing `"Ballon d'Or"` |
| Chance of 0 / 1 / 2 / 3 transfer offers | `OFFER_ODDS` |
| Injury types and lengths (weeks) | `INJURIES` |
| Promoted vs released at 18 | the `"Promoted"` / `"Released"` weights |
| Poor form / hot streak rates | `const form = fr < 0.18 ? "poor" : fr > 0.88 ? "hot"` |
| Retirement age | `retireAge` |
| Continent call-up and World Cup odds | `CONTINENTS` |
| Career verdict thresholds | `summarize` (e.g. `score >= 88` is All-time great) |
| Manager career after retiring | `managerCareer` |

Rivalries (joining a rival makes you a traitor) live in `build.py` under `RIVALRIES`. They're written as `Club A / Club B;` pairs, using the exact club names from `clubs.json`.

## Club data format (`src/clubs.json`)

```json
{ "id": "arsenal", "name": "Arsenal", "leagueId": "premier-league", "country": "England",
  "tier": 1, "academy": { "rank": 4, "bonus": 1 } }
```

- `tier` is 1–5 and controls how strong the club is and how likely it is to win things.
- `academy` is only on the 40 starting academies (the top 8 in each top-five league).
- To add a club, give it a unique `id`, an existing `leagueId` and a `tier`, then rebuild.
