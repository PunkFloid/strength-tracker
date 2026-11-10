// strength.js - skóre síly (Overall + 7 svalů)
// Metoda: pro každý cvik se týden po týdnu určí výkon v klouzavém okně (okno se podle četnosti
// cviku zkracuje nebo prodlužuje). Pro každý sval se pak odhadne jeden společný trend
// (každý cvik má vlastní úroveň, trend je pro všechny cviky stejný).
// Skóre = 50 × (trend vůči průměru prvních 4 týdnů od ANCHOR_DAY).
// Režimy:
//   'max'  - Maximum: nejlepší výkon cviku za posledních 12 týdnů (pevné okno), pauza skóre nesnižuje
//   'form' - starý výpočet Formy (již se nepoužívá; Forma 0-10 je v bplus-tuning.js)
const Strength = (() => {
  const K_SESSIONS = 3;     // okno cviku (jen stará Forma) má obsahovat aspoň tolik tréninků ...
  const MIN_DAYS = 14;      // ... ale vždy aspoň posledních 14 dní ...
  const MAX_DAYS = 84;      // ... a nejvýš 84 dní zpět; u Maxima je to pevné okno 12 týdnů
  // --- ladění režimu 'form' ---
  const FORM_WEIGHTS = [1, 0.3, 0.1];  // váhy tréninků od nejnovějšího
  const PR_BOOST = 0.5;     // nový rekord (nejlepší z posledních tréninků) posune výkon o tuto část k nejnovější hodnotě
  const GRACE_DAYS = 7;     // pokles po pauze začíná až po tolika dnech bez cviku
  const DECAY_PER_WEEK = 0.03;         // pokles výkonu za každý další týden bez cviku (3 %)
  const DECAY_CAP = 0.30;   // největší možný pokles kvůli pauze (30 %)
  const SMOOTH_FORM = 0.15; // vyhlazení trendu mezi týdny (menší = víc výkyvů)
  const SMOOTH_MAX = 0.5;
  // ---
  const GATE_DAYS = 42;     // sval se zobrazí, má-li za tuto dobu aspoň MIN_SETS pracovních sérií
  const MIN_SETS = 6;
  const READY_DAYS = 27;    // sval se začne počítat až 27 dní po prvním tréninku
  const ANCHOR_WEEKS = 4;   // 50 bodů = průměr prvních 4 týdnů od ANCHOR_DAY
  const ANCHOR_DAY = '2025-09-01';      // starší týdny jsou orientační a mohou být pod 50
  const BASE = 50;
  const STEP = 7;
  const DAY = 86400000;

  const toNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const toIso = n => new Date(n * DAY).toISOString().slice(0, 10);
  const ANCHOR_N = toNum(ANCHOR_DAY);

  // řešení soustavy A x = b (Gaussova eliminace s výběrem pivotu)
  function solve(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        if (f === 0) continue;
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }

  function compute(sets, today, mode) {
    mode = mode || 'form';
    const smooth = mode === 'max' ? SMOOTH_MAX : SMOOTH_FORM;
    const work = new Map();      // cvik -> dny pracovních sérií
    const daily = new Map();     // cvik -> (den -> nejlepší výkon z použitelných sérií)
    let minT = Infinity;
    for (const s of sets) {
      const t = toNum(s.day);
      if ((s.category === 'standard' || s.category === 'failure') && s.weight > 0 && s.reps !== null) {
        if (!work.has(s.exercise)) work.set(s.exercise, []);
        work.get(s.exercise).push(t);
      }
      if (!s.eligible) continue;
      if (!daily.has(s.exercise)) daily.set(s.exercise, new Map());
      const dm = daily.get(s.exercise), v = E1rm.setValue(s);
      if (!dm.has(t) || v > dm.get(t)) dm.set(t, v);
      if (t < minT) minT = t;
    }
    if (!daily.size) return null;
    const sess = new Map();      // cvik -> [{t, v}] seřazeno vzestupně
    for (const [ex, dm] of daily) sess.set(ex, [...dm].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t));

    const todayN = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY;
    const dow = (new Date(minT * DAY).getUTCDay() + 6) % 7;      // 0 = pondělí
    const dates = [];
    for (let t = minT + ((7 - dow) % 7); t <= todayN; t += STEP) dates.push(t);
    if (!dates.length || dates[dates.length - 1] < todayN) dates.push(todayN);

    // Maximum: pevné okno 12 týdnů; stará Forma: okno podle četnosti cviku
    const minDays = mode === 'max' ? MAX_DAYS : MIN_DAYS;
    // výkon cviku k danému dni (klouzavé okno)
    const perf = ts => {
      const E = new Map();
      for (const [ex, arr] of sess) {
        let i = arr.length - 1;
        while (i >= 0 && arr[i].t > ts) i--;
        const chosen = [];                       // od nejnovějšího
        for (let j = i; j >= 0; j--) {
          const { t, v } = arr[j];
          if (t <= ts - MAX_DAYS) break;
          if (t > ts - minDays || chosen.length < K_SESSIONS) chosen.push({ t, v });
          else break;
        }
        if (!chosen.length) continue;
        if (mode === 'max') {
          E.set(ex, Math.max(...chosen.map(c => c.v)));
        } else {
          let num = 0, den = 0;
          chosen.forEach((c, n) => { const w = FORM_WEIGHTS[Math.min(n, FORM_WEIGHTS.length - 1)]; num += w * c.v; den += w; });
          let val = num / den;
          // nový rekord: nejnovější výkon je lepší než všechny starší v okně
          if (chosen.length > 1 && chosen[0].v > Math.max(...chosen.slice(1).map(c => c.v))) val += PR_BOOST * (chosen[0].v - val);
          const age = ts - chosen[0].t;
          const decay = Math.min(DECAY_CAP, DECAY_PER_WEEK * Math.max(0, age - GRACE_DAYS) / 7);
          E.set(ex, val * Math.exp(-decay));
        }
      }
      return E;
    };
    const Es = dates.map(perf);

    const out = { dates, overall: [], muscles: {}, anchorN: ANCHOR_N, mode };
    for (const [key] of Muscles.LIST) {
      out.muscles[key] = new Array(dates.length).fill(null);
      const exs = [];
      for (const ex of sess.keys()) {
        const w = Muscles.WEIGHTS[ex];
        if (w && w[key]) exs.push([ex, w[key]]);
      }
      const main = exs.filter(([, w]) => w >= 0.5);
      if (!main.length) continue;
      const first = Math.min(...main.map(([ex]) => Math.min(...(work.get(ex) || [Infinity]), sess.get(ex)[0].t)));

      // týdny, ve kterých sval má dost dat
      const active = [], obs = [];
      dates.forEach((ts, k) => {
        let nSets = 0;
        for (const [ex] of main) for (const t of (work.get(ex) || [])) if (t > ts - GATE_DAYS && t <= ts) nSets++;
        const rec = [];
        for (const [ex, w] of exs) if (Es[k].has(ex)) rec.push([ex, w, Math.log(Es[k].get(ex))]);
        if (ts >= first + READY_DAYS && nSets >= MIN_SETS && rec.length) { active.push(k); obs.push([active.length - 1, rec]); }
      });
      const K = active.length;
      if (K < 3) continue;

      // společný trend: y(týden, cvik) = s(týden) + a(cvik), vyhlazené mezi sousedními týdny
      const names = [...new Set(obs.flatMap(([, rec]) => rec.map(r => r[0])))];
      const eIdx = new Map(names.map((n, i) => [n, i]));
      const N = Array.from({ length: K + names.length }, () => new Array(K + names.length).fill(0));
      const b = new Array(K + names.length).fill(0);
      for (const [i, rec] of obs) for (const [ex, w, y] of rec) {
        const c = K + eIdx.get(ex);
        N[i][i] += w; N[c][c] += w; N[i][c] += w; N[c][i] += w; b[i] += w * y; b[c] += w * y;
      }
      for (let i = 0; i < K - 1; i++) {
        N[i][i] += smooth; N[i + 1][i + 1] += smooth; N[i][i + 1] -= smooth; N[i + 1][i] -= smooth;
      }
      // kotva: průměr prvních týdnů od ANCHOR_DAY = 0 (50 bodů)
      let anc = [];
      active.forEach((k, i) => { if (dates[k] >= ANCHOR_N && anc.length < ANCHOR_WEEKS) anc.push(i); });
      if (!anc.length) for (let i = 0; i < Math.min(ANCHOR_WEEKS, K); i++) anc.push(i);
      for (const i of anc) for (const j of anc) N[i][j] += 1e4 / (anc.length * anc.length);
      const x = solve(N, b);
      active.forEach((k, i) => { out.muscles[key][k] = BASE * Math.exp(x[i]); });
    }

    // celkové skóre: průměrná změna svalů, které byly aktivní v předchozím i tomto týdnu
    let overall = null, prev = {};
    const ov = [];
    dates.forEach((ts, k) => {
      const now = {};
      for (const [key] of Muscles.LIST) if (out.muscles[key][k] !== null) now[key] = out.muscles[key][k];
      let logSum = 0, c = 0;
      for (const key in now) if (prev[key] !== undefined) { logSum += Math.log(now[key] / prev[key]); c++; }
      if (overall === null) { if (Object.keys(now).length) overall = BASE; }
      else if (c > 0) overall *= Math.exp(logSum / c);
      ov.push(Object.keys(now).length ? overall : null);
      if (Object.keys(now).length) prev = now;
    });
    const aIdx = [];
    ov.forEach((v, k) => { if (v !== null && dates[k] >= ANCHOR_N && aIdx.length < ANCHOR_WEEKS) aIdx.push(k); });
    const scale = aIdx.length ? BASE / (aIdx.reduce((s, k) => s + ov[k], 0) / aIdx.length) : 1;
    out.overall = ov.map(v => (v === null ? null : v * scale));
    return out;
  }

  // převod na "sessions" pro E1rm.series (bod = nejvyšší skóre v týdnu/měsíci);
  // týdny před ANCHOR_DAY jsou orientační (prázdné kolečko)
  function sessionsFor(result, key) {
    const vals = key === 'overall' ? result.overall : result.muscles[key];
    const out = [];
    result.dates.forEach((d, i) => { if (vals[i] !== null) out.push({ day: toIso(d), value: vals[i], estimated: d < result.anchorN }); });
    return out;
  }

  return { compute, sessionsFor, toIso };
})();
if (typeof module !== 'undefined') module.exports = Strength;
