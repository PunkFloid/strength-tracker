// bplus-tuning.js - kalibrace 1RM po cvicích + Forma v3 (0-10 podle svalů) + časová agregace Formy
// Vkládá se po e1rm.js, muscles.js a strength.js, ale před app.js.
const BPlusTuning = (() => {
  // --- kalibrace sklonu křivky 1RM ---
  // 1RM = váha × (1 + k × min(opakování + RIR, 30) / 30) × perHandFactor
  // Výchozí k: 2 pro cviky horního těla s činkami (z porovnání s MacroFactorem), 1,2 pro kabely a stroje na horní tělo
  // (z porovnání s 1RM z exportu MacroFactoru, 11. 2026), 1 (Epley) pro nohy a cviky mimo tabulku svalů.
  // Pokud má cvik dost tréninků s různým počtem opakování, k se doladí z dat.
  const UPPER = { k: 2, maxEffectiveReps: 30 };
  const CABLE_K = 1.2;
  const LEG_K = 1;
  const FIT = { minSessions: 6, minRepSpread: 5, kMin: 0.8, kMax: 2.5, step: 0.05, lambda: 0.1 };

  const isUpperBody = name => {
    const w = Muscles.WEIGHTS[name];
    return !!w && !w.quads && !w.hamstrings;
  };
  // kabely a stroje (bez Smith machine, asistovaných cviků a crunch)
  const isCableOrMachine = name => /cable|pin-loaded|plate-loaded|machine|pec deck|ez bar|bayesian/i.test(name) && !/smith|assisted|crunch/i.test(name);
  const priorK = name => (!isUpperBody(name) ? LEG_K : (isCableOrMachine(name) ? CABLE_K : UPPER.k));

  let slopes = {};            // cvik -> doladěné k
  let calibratedFor = null;   // pole sérií, pro které se kalibrovalo naposledy

  const effOf = s => Math.min(s.reps + s.rir, UPPER.maxEffectiveReps);

  E1rm.setValue = function (s) {
    const k = slopes[s.exercise] !== undefined ? slopes[s.exercise] : priorK(s.exercise);
    return s.weight * (1 + k * effOf(s) / 30) * s.perHandFactor;
  };

  function fitSlopes(sets) {
    const byEx = new Map();
    for (const s of sets) {
      if (!s.eligible || !(s.weight > 0) || s.reps === null || s.reps === undefined) continue;
      if (!byEx.has(s.exercise)) byEx.set(s.exercise, new Map());
      const days = byEx.get(s.exercise);
      if (!days.has(s.day)) days.set(s.day, []);
      days.get(s.day).push(s);
    }
    const result = {};
    for (const [ex, days] of byEx) {
      const list = [...days].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, arr]) => arr);
      if (list.length < FIT.minSessions) continue;
      const prior = priorK(ex);
      const best = k => list.map(arr => Math.max(...arr.map(s => s.weight * (1 + k * effOf(s) / 30) * s.perHandFactor)));
      const effs = list.map(arr => {
        let bi = 0, bv = -Infinity;
        arr.forEach((s, i) => { const v = s.weight * (1 + prior * effOf(s) / 30) * s.perHandFactor; if (v > bv) { bv = v; bi = i; } });
        return effOf(arr[bi]);
      });
      if (Math.max(...effs) - Math.min(...effs) < FIT.minRepSpread) continue;
      let bestK = prior, bestObj = Infinity;
      for (let k = FIT.kMin; k <= FIT.kMax + 1e-9; k += FIT.step) {
        const v = best(k);
        let sse = 0;
        for (let i = 1; i < v.length; i++) sse += Math.pow(Math.log(v[i]) - Math.log(v[i - 1]), 2);
        const obj = sse / (v.length - 1) + FIT.lambda * Math.pow(Math.log(k / prior), 2);
        if (obj < bestObj) { bestObj = obj; bestK = k; }
      }
      result[ex] = Math.round(bestK * 100) / 100;
    }
    return result;
  }

  function calibrate(sets) {
    if (calibratedFor === sets) return;
    slopes = fitSlopes(sets);
    calibratedFor = sets;
    api.slopes = slopes;
  }

  // E1rm.sessions uvnitř volá lokální setValue, proto je potřeba ho přepsat zvlášť.
  E1rm.sessions = function (sets, exercise) {
    calibrate(sets);
    const byDay = new Map();
    for (const s of sets) {
      if (!s.eligible || s.exercise !== exercise) continue;
      const v = E1rm.setValue(s);
      const cur = byDay.get(s.day);
      if (!cur || v > cur.value) byDay.set(s.day, { day: s.day, value: v, estimated: s.rirEstimated });
    }
    return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  };

  // --- Forma v3 (0-10) ---
  // Forma ukazuje směr, ne úroveň: 0 = všechny svaly se zhoršují, 5 = stagnace, 10 = všechny rostou.
  // Cvik: nejlepší odhad 1RM za posledních 28 dní vs. nejlepší z předchozích 84 dní (stejná pravidla jako karta
  // "Svaly podle posledních maxim" v záložece Trénink). Sval: vážený průměr změny jeho cviků. Overall: průměr svalů s daty.
  const FORM = {
    recentDays: 28,     // nedávné období = 4 týdny
    refDays: 84,        // srovnání s 12 týdny před ním
    minRecent: 2,       // cvik: aspoň 2 tréninky v nedávném období ...
    minRef: 2,          // ... a aspoň 2 v referenčním
    sensitivity: 0.05,  // změna +5 % a víc = 10 bodů, −5 % a méně = 0 bodů, 0 % = 5 bodů
    step: 7             // bod Formy každý týden (poslední bod je dnešek)
  };
  const DAY_MS = 86400000;
  const toNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };
  const scoreOf = change => 5 + 5 * Math.max(-1, Math.min(1, change / FORM.sensitivity));

  function computeForm(sets, today) {
    const daily = new Map();
    let minT = Infinity;
    for (const s of sets) {
      if (!s.eligible) continue;
      const t = toNum(s.day), v = E1rm.setValue(s);
      if (!daily.has(s.exercise)) daily.set(s.exercise, new Map());
      const dm = daily.get(s.exercise);
      if (!dm.has(t) || v > dm.get(t)) dm.set(t, v);
      if (t < minT) minT = t;
    }
    if (!daily.size) return null;
    const sess = new Map();
    for (const [ex, dm] of daily) sess.set(ex, [...dm].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t));

    const todayN = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY_MS;
    const dates = [];
    for (let t = todayN; t >= minT; t -= FORM.step) dates.unshift(t);
    if (!dates.length) dates.push(todayN);

    const out = { dates, overall: [], muscles: {}, anchorN: -Infinity, mode: 'form' };
    for (const [key] of Muscles.LIST) out.muscles[key] = [];
    dates.forEach(t => {
      let sum = 0, count = 0;
      for (const [key] of Muscles.LIST) {
        let num = 0, den = 0;
        for (const [ex, arr] of sess) {
          const w = (Muscles.WEIGHTS[ex] || {})[key];
          if (!w) continue;
          let rBest = -Infinity, rN = 0, fBest = -Infinity, fN = 0;
          for (const p of arr) {
            const age = t - p.t;
            if (age < 0) break;
            if (age < FORM.recentDays) { rN++; if (p.v > rBest) rBest = p.v; }
            else if (age < FORM.recentDays + FORM.refDays) { fN++; if (p.v > fBest) fBest = p.v; }
          }
          if (rN < FORM.minRecent || fN < FORM.minRef) continue;
          num += w * (rBest / fBest - 1);
          den += w;
        }
        if (den > 0) {
          const sc = scoreOf(num / den);
          out.muscles[key].push(sc);
          sum += sc; count++;
        } else {
          out.muscles[key].push(null);
        }
      }
      out.overall.push(count ? sum / count : null);
    });
    return out;
  }

  // Forma i Maximum nejdřív kalibrují 1RM; Forma jde přes computeForm (0-10), Maximum přes původní výpočet
  const originalCompute = Strength.compute;
  Strength.compute = function (sets, today, mode) {
    calibrate(sets);
    if ((mode || 'form') === 'form') {
      try {
        return computeForm(sets, today);
      } catch (err) {
        console.warn('Forma se nepodařila spočítat:', err);
        return null;
      }
    }
    return originalCompute(sets, today, mode);
  };

  // Forma se zobrazuje jako stav na konci týdne/měsíce; Maximum dál ukazuje nejvyšší bod.
  const originalSessionsFor = Strength.sessionsFor;
  Strength.sessionsFor = function (result, key) {
    const sessions = originalSessionsFor(result, key);
    sessions.aggregation = result.mode === 'form' ? 'last' : 'max';
    return sessions;
  };

  const originalSeries = E1rm.series;
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  E1rm.series = function (sessions, period, today, aggregation) {
    const mode = aggregation || sessions.aggregation || 'max';
    const data = originalSeries(sessions, period, today);
    if (mode !== 'last' || !data.buckets.length) return data;

    const fromKey = dayKey(data.from), endKey = dayKey(data.end);
    const inRange = sessions.filter(s => s.day >= fromKey && s.day <= endKey);
    for (const bucket of data.buckets) {
      const start = dayKey(bucket.start), end = dayKey(bucket.end);
      let latest = null;
      for (const s of inRange) {
        if (s.day >= start && s.day <= end && (!latest || s.day > latest.day)) latest = s;
      }
      bucket.value = latest ? latest.value : null;
      bucket.estimated = latest ? latest.estimated : false;
    }
    data.points = data.buckets.filter(b => b.value !== null);
    const values = data.points.map(p => p.value);
    data.min = values.length ? Math.min(...values) : null;
    data.max = values.length ? Math.max(...values) : null;
    data.avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    data.pr = inRange.length ? Math.max(...inRange.map(s => s.value)) : null;
    return data;
  };

  const api = { upperBodyCalibration: UPPER, cableK: CABLE_K, isUpperBody, isCableOrMachine, slopes, form: FORM, fit: FIT };
  return api;
})();
