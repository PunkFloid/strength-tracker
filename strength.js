// strength.js - skóre síly (Overall + 7 svalů), řetězený index od hodnoty 50
const Strength = (() => {
  const WINDOW = 28;     // okno ve dnech: nejlepší výkon cviku za posledních 28 dní
  const STEP = 7;        // skóre se počítá po týdnech
  const MIN_SETS = 6;    // sval se zobrazí, až má v okně aspoň tolik sérií
  const BASE = 50;       // počáteční hodnota
  const DAY = 86400000;

  const toNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const toIso = n => new Date(n * DAY).toISOString().slice(0, 10);

  function compute(sets, today) {
    const byEx = new Map();     // použitelné série (s RIR) -> výkon
    const work = new Map();     // všechny pracovní série -> dny (pro počítání sérií)
    let minT = Infinity;
    for (const s of sets) {
      const t = toNum(s.day);
      const isWork = (s.category === 'standard' || s.category === 'failure') && s.weight > 0 && s.reps !== null;
      if (isWork) {
        if (!work.has(s.exercise)) work.set(s.exercise, []);
        work.get(s.exercise).push(t);
      }
      if (!s.eligible) continue;
      if (!byEx.has(s.exercise)) byEx.set(s.exercise, []);
      byEx.get(s.exercise).push({ t, v: E1rm.setValue(s) });
      if (t < minT) minT = t;
    }
    if (!byEx.size) return null;
    for (const arr of byEx.values()) arr.sort((a, b) => a.t - b.t);

    const todayN = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / DAY;
    const dow = (new Date(minT * DAY).getUTCDay() + 6) % 7;      // 0 = pondělí
    const dates = [];
    for (let t = minT + ((7 - dow) % 7); t <= todayN; t += STEP) dates.push(t);
    if (!dates.length || dates[dates.length - 1] < todayN) dates.push(todayN);

    const exOf = {};   // sval -> [[cvik, váha]]
    for (const [key] of Muscles.LIST) exOf[key] = [];
    const firstDay = {};   // první trénink svalu (sval se začne počítat až po prvním celém okně)
    for (const ex of new Set([...byEx.keys(), ...work.keys()])) {
      const w = Muscles.WEIGHTS[ex];
      if (!w) continue;
      const first = Math.min(...(work.get(ex) || [Infinity]), ...(byEx.has(ex) ? [byEx.get(ex)[0].t] : [Infinity]));
      for (const key in w) {
        exOf[key].push([ex, w[key]]);
        if (w[key] >= 0.5 && (firstDay[key] === undefined || first < firstDay[key])) firstDay[key] = first;
      }
    }

    const out = { dates, overall: [], muscles: {} };
    const lastE = {}, cur = {};
    for (const [key] of Muscles.LIST) { out.muscles[key] = []; lastE[key] = null; cur[key] = null; }
    let overall = null;
    let prevS = {};

    for (const ts of dates) {
      // nejlepší výkon a počet sérií každého cviku v okně (ts - 28, ts]
      const E = new Map(), cnt = new Map();
      for (const [ex, arr] of byEx) {
        let best = null, n = 0;
        for (const p of arr) if (p.t > ts - WINDOW && p.t <= ts) { n++; if (best === null || p.v > best) best = p.v; }
        if (best !== null) { E.set(ex, best); cnt.set(ex, n); }
      }
      const nowS = {};
      for (const [key] of Muscles.LIST) {
        let nSets = 0;
        for (const [ex, w] of exOf[key]) {
          if (w < 0.5) continue;
          for (const t of (work.get(ex) || [])) if (t > ts - WINDOW && t <= ts) nSets++;
        }
        const nowE = new Map();
        for (const [ex] of exOf[key]) if (E.has(ex)) nowE.set(ex, E.get(ex));
        const ready = firstDay[key] !== undefined && ts >= firstDay[key] + WINDOW - 1;
        if (!ready || nSets < MIN_SETS || nowE.size === 0) { out.muscles[key].push(null); continue; }
        if (cur[key] === null) {
          cur[key] = BASE;
        } else {
          let num = 0, den = 0;
          for (const [ex, w] of exOf[key]) {
            if (nowE.has(ex) && lastE[key].has(ex)) { num += w * Math.log(nowE.get(ex) / lastE[key].get(ex)); den += w; }
          }
          if (den > 0) cur[key] *= Math.exp(num / den);
        }
        lastE[key] = nowE;
        nowS[key] = cur[key];
        out.muscles[key].push(cur[key]);
      }
      // celkové skóre: průměrná změna svalů, které byly aktivní v předchozím i tomto vzorku
      let logSum = 0, k = 0;
      for (const key in nowS) if (prevS[key] !== undefined) { logSum += Math.log(nowS[key] / prevS[key]); k++; }
      if (overall === null) { if (Object.keys(nowS).length) overall = BASE; }
      else if (k > 0) overall *= Math.exp(logSum / k);
      out.overall.push(Object.keys(nowS).length ? overall : null);
      if (Object.keys(nowS).length) prevS = nowS;
    }
    return out;
  }

  // převod na "sessions" pro E1rm.series (bod = nejvyšší skóre v týdnu/měsíci)
  function sessionsFor(result, key) {
    const vals = key === 'overall' ? result.overall : result.muscles[key];
    const out = [];
    result.dates.forEach((d, i) => { if (vals[i] !== null) out.push({ day: toIso(d), value: vals[i], estimated: false }); });
    return out;
  }

  return { compute, sessionsFor, toIso };
})();
if (typeof module !== 'undefined') module.exports = Strength;