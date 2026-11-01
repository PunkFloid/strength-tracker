// normalize.js - sjednocení obou formátů do jednoho tvaru + slučování
const Normalize = (() => {
  const RIR_FALLBACK = 1.0;   // náhradní RIR u starého exportu, když se série mění
  const RIR_CAP = 3;          // nejvyšší RIR odhadnuté z pořadí sérií

  const num = v => {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(String(v).trim());
    return isNaN(n) ? null : n;
  };
  const cleanName = s => (s || '').replace(/\s*∈.*$/, '').trim();

  function categoryMF(setType) {
    const t = setType.replace(/\s*\([LR]\)$/, '');
    if (t === 'Warm-Up Set') return 'warmup';
    if (t === 'Standard Set') return 'standard';
    if (t === 'Failure Set') return 'failure';
    if (t === 'Myo Set') return 'myo';
    if (t === 'Mini-set') return 'mini';
    if (t === 'Drop Set' || t === 'Drop') return 'drop';
    return 'other';
  }

  function fromMacroFactor(rows) {
    return rows.map(r => {
      const cat = categoryMF(r['Set Type'] || '');
      const weight = num(r['Weight (kg)']);
      const base = num(r['Exercise Base Weight (kg)']);
      let total = weight;
      if (weight !== null && base && weight < base) total = weight + base; // pravidlo hack squatu
      let rir = num(r['RIR']);
      if (rir === null && cat === 'failure') rir = 0;
      const working = cat === 'standard' || cat === 'failure';
      const ex = Exercises.lookup(cleanName(r['Exercise']));
      return {
        source: 'macrofactor',
        day: (r['Date'] || '').slice(0, 10),
        exercise: ex.canonical,
        rawExercise: cleanName(r['Exercise']),
        load: ex.load,
        known: ex.known,
        perHandFactor: ex.load === 'pair' ? 0.5 : 1,
        category: cat,
        weight: total,
        reps: num(r['Reps']),
        rir,
        rirEstimated: false,
        eligible: working && total !== null && total > 0 && rir !== null && num(r['Reps']) !== null
      };
    });
  }

  function fromOld(rows) {
    const sets = [];
    const groups = new Map();
    for (const r of rows) {
      const mult = num(r['multiplier']) || 0;
      if (mult <= 0) continue; // cardio, plank apod.
      const day = Parser.pragueDay(r['Date']);
      const warm = (r['isWarmup'] || '').toLowerCase() === 'true';
      const isDrop = (r['Note'] || '') === 'Drop Set';
      const weight = num(r['Weight(kg)']);
      const ex = Exercises.lookup(cleanName(r['Exercise']));
      // multiplier platí jen pro pár činek a kotouče na obou stranách, jinde se váha nenásobí
      const factor = (ex.load === 'pair' || ex.load === 'platePerSide') ? mult : 1;
      const rec = {
        source: 'old',
        day,
        exercise: ex.canonical,
        rawExercise: cleanName(r['Exercise']),
        load: ex.load,
        known: ex.known,
        perHandFactor: ex.load === 'pair' ? 0.5 : 1,
        category: warm ? 'warmup' : (isDrop ? 'drop' : 'standard'),
        weight: weight === null ? null : weight * factor,
        reps: num(r['Reps']),
        rir: null,
        rirEstimated: false,
        eligible: false
      };
      sets.push(rec);
      if (rec.category === 'standard' && rec.weight > 0 && rec.reps !== null) {
        const key = day + '|' + rec.exercise;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rec);
      }
    }
    // odhad RIR: poslední série 0, předposlední 1 ...; když se váha/opakování mění, všude náhradní hodnota
    for (const g of groups.values()) {
      const uniform = g.every(s => s.weight === g[0].weight && s.reps === g[0].reps);
      g.forEach((s, i) => {
        s.rir = uniform ? Math.min(g.length - 1 - i, RIR_CAP) : RIR_FALLBACK;
        s.rirEstimated = true;
        s.eligible = true;
      });
    }
    return sets;
  }

  // dny, které existují v MacroFactoru, se ze starého exportu zahodí
  function merge(mfSets, oldSets) {
    const mfDays = new Set(mfSets.map(s => s.day));
    const oldDays = new Set(oldSets.map(s => s.day));
    const keptOld = oldSets.filter(s => !mfDays.has(s.day));
    const keptOldDays = new Set(keptOld.map(s => s.day));
    const overlapDays = [...oldDays].filter(d => mfDays.has(d)).length;
    const all = mfSets.concat(keptOld);
    const eligible = all.filter(s => s.eligible);
    return {
      sets: all,
      stats: {
        totalSets: all.length,
        days: mfDays.size + keptOldDays.size,
        daysMF: mfDays.size,
        daysOldKept: keptOldDays.size,
        overlapDays,
        eligibleSets: eligible.length,
        eligibleFromOld: eligible.filter(s => s.source === 'old').length,
        exercises: new Set(all.map(s => s.exercise)).size,
        unlisted: [...new Set(all.filter(s => !s.known).map(s => s.rawExercise))],
        minDay: all.reduce((m, s) => (!m || s.day < m ? s.day : m), ''),
        maxDay: all.reduce((m, s) => (!m || s.day > m ? s.day : m), '')
      }
    };
  }

  return { fromMacroFactor, fromOld, merge };
})();
if (typeof module !== 'undefined') module.exports = Normalize;