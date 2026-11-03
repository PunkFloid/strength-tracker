// bplus-tuning.js - kalibrace 1RM po cvicích + Forma v2 (krátkodobá) + časová agregace Formy
// Vkládá se po e1rm.js, muscles.js a strength.js, ale před app.js.
const BPlusTuning = (() => {
  // --- kalibrace sklonu křivky 1RM ---
  // 1RM = váha × (1 + k × min(opakování + RIR, 30) / 30) × perHandFactor
  // Výchozí k: 2 pro cviky horního těla (z porovnání s MacroFactorem), 1 (Epley) pro nohy a cviky mimo tabulku svalů.
  // Pokud má cvik dost tréninků s různým počtem opakování, k se doladí z dat.
  const UPPER = { k: 2, maxEffectiveReps: 30 };
  const LEG_K = 1;
  const FIT = { minSessions: 6, minRepSpread: 5, kMin: 0.8, kMax: 2.5, step: 0.05, lambda: 0.1 };

  const isUpperBody = name => {
    const w = Muscles.WEIGHTS[name];
    return !!w && !w.quads && !w.hamstrings;
  };
  const priorK = name => (isUpperBody(name) ? UPPER.k : LEG_K);

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

  // --- Forma v2 ---
  // Forma svalu = úroveň svalu z Maxima × odchylka posledních tréninků od normálu cviku × pokles po pauze.
  const FORM = {
    tauDays: 4,          // čerstvost tréninku: exp(-dny / 4) -> 4 dny ≈ 37 %, 8 dní ≈ 14 %
    normalDays: 42,      // normál cviku = průměr e1RM z předchozích tréninků za posledních 42 dní
    clamp: 0.12,         // odchylka nejvýš ±12 %
    freshDays: 28,       // starší tréninky se do odchylky už nepočítají
    graceDays: 7,        // pokles po pauze začíná po 7 dnech bez cviku svalu
    decayPerWeek: 0.03,  // 3 % za každý další týden
    decayCap: 0.30,      // nejvýš 30 %
    staleDays: 14        // starší poslední trénink -> prázdné kolečko
  };
  const DAY_MS = 86400000;
  const toNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };

  function lastIndexAtOrBefore(arr, t) {
    let lo = 0, hi = arr.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t) { res = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return res;
  }

  function computeForm(sets, today, baseCompute) {
    const maxRes = baseCompute(sets, today, 'max');
    if (!maxRes) return null;

    const daily = new Map();
    for (const s of sets) {
      if (!s.eligible) continue;
      if (!daily.has(s.exercise)) daily.set(s.exercise, new Map());
      const dm = daily.get(s.exercise), t = toNum(s.day), v = E1rm.setValue(s);
      if (!dm.has(t) || v > dm.get(t)) dm.set(t, v);
    }
    if (!daily.size) return null;

    const todayN = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY_MS;
    const sess = new Map();
    const allDays = new Set();
    for (const [ex, dm] of daily) {
      const arr = [...dm].map(([t, v]) => ({ t, v, dev: null })).sort((a, b) => a.t - b.t);
      arr.forEach((c, i) => {
        allDays.add(c.t);
        let sum = 0, n = 0;
        for (let j = i - 1; j >= 0 && arr[j].t > c.t - FORM.normalDays; j--) { sum += arr[j].v; n++; }
        if (n) c.dev = Math.max(-FORM.clamp, Math.min(FORM.clamp, c.v / (sum / n) - 1));
      });
      sess.set(ex, arr);
    }
    const dates = [...allDays].filter(t => t <= todayN).sort((a, b) => a - b);
    if (!dates.length || dates[dates.length - 1] < todayN) dates.push(todayN);

    const out = { dates, overall: [], muscles: {}, stale: {}, anchorN: maxRes.anchorN, mode: 'form' };
    const ratio = {}, isStale = {};
    for (const [key] of Muscles.LIST) {
      const exs = [];
      for (const ex of sess.keys()) { const w = Muscles.WEIGHTS[ex]; if (w && w[key]) exs.push([ex, w[key]]); }
      const levels = maxRes.muscles[key];
      out.muscles[key] = []; out.stale[key] = []; ratio[key] = []; isStale[key] = [];
      dates.forEach(t => {
        const i = lastIndexAtOrBefore(maxRes.dates, t);
        const level = i >= 0 && levels ? levels[i] : null;
        if (level === null || level === undefined || !exs.length) {
          out.muscles[key].push(null); out.stale[key].push(false); ratio[key].push(null); isStale[key].push(false);
          return;
        }
        let num = 0, den = 0, last = -Infinity;
        for (const [ex, w] of exs) {
          for (const c of sess.get(ex)) {
            if (c.t > t) break;
            if (c.t > last) last = c.t;
            const age = t - c.t;
            if (c.dev === null || age > FORM.freshDays) continue;
            const wt = w * Math.exp(-age / FORM.tauDays);
            num += wt * c.dev; den += wt;
          }
        }
        const dev = den > 0 ? num / den : 0;
        const sinceLast = last === -Infinity ? Infinity : t - last;
        const decay = Math.min(FORM.decayCap, FORM.decayPerWeek * Math.max(0, sinceLast - FORM.graceDays) / 7);
        const r = (1 + dev) * Math.exp(-decay);
        out.muscles[key].push(level * r);
        out.stale[key].push(sinceLast > FORM.staleDays);
        ratio[key].push(r); isStale[key].push(sinceLast > FORM.staleDays);
      });
    }
    out.stale.overall = [];
    dates.forEach((t, k) => {
      const i = lastIndexAtOrBefore(maxRes.dates, t);
      const base = i >= 0 ? maxRes.overall[i] : null;
      let logSum = 0, c = 0, allStale = true;
      for (const [key] of Muscles.LIST) {
        if (ratio[key][k] === null) continue;
        logSum += Math.log(ratio[key][k]); c++;
        if (!isStale[key][k]) allStale = false;
      }
      if (base === null || base === undefined || !c) { out.overall.push(null); out.stale.overall.push(false); }
      else { out.overall.push(base * Math.exp(logSum / c)); out.stale.overall.push(allStale); }
    });
    return out;
  }

  // Forma i Maximum počítají nejdřív kalibraci 1RM; Forma jde přes computeForm (při chybě se vrátí ke staré metodě)
  const originalCompute = Strength.compute;
  Strength.compute = function (sets, today, mode) {
    calibrate(sets);
    if ((mode || 'form') === 'form') {
      try {
        const r = computeForm(sets, today, originalCompute);
        if (r) return r;
      } catch (err) {
        console.warn('Forma v2 se nepodařila, použije se původní výpočet:', err);
      }
    }
    return originalCompute(sets, today, mode);
  };

  // Forma se zobrazuje jako stav na konci týdne/měsíce; Maximum dál ukazuje nejvyšší bod.
  // Body Formy starší než 14 dní od posledního tréninku svalu jsou označené jako odhad (prázdné kolečko).
  const originalSessionsFor = Strength.sessionsFor;
  Strength.sessionsFor = function (result, key) {
    const sessions = originalSessionsFor(result, key);
    sessions.aggregation = result.mode === 'form' ? 'last' : 'max';
    const flags = result.stale && result.stale[key];
    if (flags) {
      const staleDays = new Set();
      result.dates.forEach((d, i) => { if (flags[i]) staleDays.add(Strength.toIso(d)); });
      for (const s of sessions) if (staleDays.has(s.day)) s.estimated = true;
    }
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

  const api = { upperBodyCalibration: UPPER, isUpperBody, slopes, form: FORM, fit: FIT };
  return api;
})();
