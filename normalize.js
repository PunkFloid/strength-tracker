// normalize.js - sjednocení obou formátů do jednoho tvaru + slučování
const Normalize = (() => {
  const RIR_FALLBACK = 1.0;   // náhradní RIR u starého exportu, když se série mění
  const RIR_CAP = 3;          // nejvyšší RIR odhadnuté z pořadí sérií

  // rychlé vyhledání cviku podle názvu nebo aliasu
  const lookup = new Map();
  for (const e of EXERCISES) {
    lookup.set(e.name.toLowerCase(), e);
    for (const a of e.aliases) lookup.set(a.toLowerCase(), e);
  }
  const findExercise = name => lookup.get(name.toLowerCase()) || null;

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

  // informace o cviku z tabulky; neznámé názvy zůstanou beze změny a jsou označené
  function describe(raw) {
    const def = findExercise(raw);
    return {
      exercise: def ? def.name : raw,
      rawExercise: raw,
      mapped: !!def,
      load: def ? def.load : 'single',
      muscles: def ? def.muscles : {},
      def
    };
  }

  function fromMacroFactor(rows) {
    return rows.map(r => {
      const info = describe(cleanName(r['Exercise']));
      const cat = categoryMF(r['Set Type'] || '');
      const weight = num(r['Weight (kg)']);
      const base = num(r['Exercise Base Weight (kg)']);
      let total = weight;
      if (weight !== null && base && weight < base) total = weight + base; // pravidlo hack squatu
      let rir = num(r['RIR']);
      if (rir === null && cat === 'failure') rir = 0;
      const working = cat === 'standard' || cat === 'failure';
      const loadOk = info.load === 'pair' || info.load === 'single';
      return {
        source: 'macrofactor',
        day: (r['Date'] || '').slice(0, 10),
        exercise: info.exercise,
        rawExercise: info.rawExercise,
        mapped: info.mapped,
        load: info.load,
        muscles: info.muscles,
        category: cat,
        weight: total,
        reps: num(r['Reps']),
        rir,
        rirEstimated: false,
        eligible: working && loadOk && total !== null && total > 0 && rir !== null && num(r['Reps']) !== null
      };
    });
  }

  function fromOld(rows) {
    const sets = [];
    const groups = new Map();
    for (const r of rows) {
      const mult = num(r['multiplier']) || 0;
      if (mult <= 0) continue; // cardio, plank apod.
      const info = describe(cleanName(r['Exercise']));
      const day = Parser.pragueDay(r['Date']);
      const warm = (r['isWarmup'] || '').toLowerCase() === 'true';
      const isDrop = (r['Note'] || '') === 'Drop Set';
      const w = num(r['Weight(kg)']);
      // dvě činky = vynásobit 2 (MacroFactor ukládá součet); ostatní beze změny
      let weight = w === null ? null : (info.load === 'pair' ? w * 2 : w);
      if (weight !== null && info.def && info.def.oldBase) weight += info.def.oldBase;
      const loadOk = info.load === 'pair' || info.load === 'single';
      const rec = {
        source: 'old',
        day,
        exercise: info.exercise,
        rawExercise: info.rawExercise,
        mapped: info.mapped,
        load: info.load,
        muscles: info.muscles,
        category: warm ? 'warmup' : (isDrop ? 'drop' : 'standard'),
        weight,
        reps: num(r['Reps']),
        rir: null,
        rirEstimated: false,
        eligible: false
      };
      sets.push(rec);
      if (rec.category === 'standard' && loadOk && rec.weight > 0 && rec.reps !== null) {
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
        eligibleExercises: new Set(eligible.map(s => s.exercise)).size,
        unmapped: [...new Set(all.filter(s => !s.mapped).map(s => s.rawExercise))],
        minDay: all.reduce((m, s) => (!m || s.day < m ? s.day : m), ''),
        maxDay: all.reduce((m, s) => (!m || s.day > m ? s.day : m), '')
      }
    };
  }

  return { fromMacroFactor, fromOld, merge, findExercise };
})();
if (typeof module !== 'undefined') module.exports = Normalize;