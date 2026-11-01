// exercises.js - tabulka cviků: sjednocení názvů mezi aplikacemi a typ zátěže
// Typy zátěže:
//   pair         = pár činek (váha je součet obou, v grafu se zobrazí polovina)
//   single       = jedna činka
//   platePerSide = kotouče na obou stranách (starý export násobí 2)
//   none         = bez vnější zátěže (vlastní váha)
//   other        = stroj, kabel, osa (váha se bere tak, jak je zapsaná)
const Exercises = (() => {
  // [hlavní název, typ zátěže, [názvy ze starého exportu / další varianty]]
  const TABLE = [
    // --- dvojice činek ---
    ['Dumbbell Bench Press', 'pair', []],
    ['45° Incline Dumbbell Press', 'pair', ['Dumbbell Incline Bench Press']],
    ['45° Incline Dumbbell Fly', 'pair', ['Dumbbell Incline Fly']],
    ['Dumbbell Fly', 'pair', []],
    ['Seated Dumbbell Overhead Press', 'pair', ['Dumbbell Shoulder Press']],
    ['Seated Neutral Grip Dumbbell Overhead Press', 'pair', ['Seated Dumbbell Front Press']],
    ['Standing Dumbbell Lateral Raise', 'pair', ['Dumbbell Lateral Raise']],
    ['Seated Dumbbell Lateral Raise', 'pair', []],
    ['Seated Neutral Grip Dumbbell Rear Delt Fly', 'pair', []],
    ['Dumbbell Skull Crusher', 'pair', ['Dumbbell Skullcrusher']],
    ['Incline Dumbbell Biceps Curl', 'pair', ['Incline Dumbbell Curl']],
    ['Seated Dumbbell Curl', 'pair', []],
    ['Dumbbell Bicep Curl', 'pair', []],
    ['Chest-Supported Dumbbell Row (Elbows-In)', 'pair', ['Incline Dumbbell Row']],
    ['Walking Lunge', 'pair', []],
    // --- jedna činka ---
    ['Dumbbell Pullover', 'single', []],
    ['Goblet Squat', 'single', []],
    ['Seated Dumbbell Overhead Triceps Extension', 'single', ['Dumbbell Tricep Extension']],
    ['Dumbbell Concentration Curl', 'single', ['Concentration Curl']],
    ['Single Arm Dumbbell Row (Elbow-In)', 'single', ['Dumbbell Row']],
    ['Single Arm Dumbbell Preacher Curl', 'single', ['Single Arm Preacher Curl']],
    // --- kotouče na obou stranách ---
    ['Hammerstrength Chest Press', 'platePerSide', []],
    // --- stroje, kabely, osy ---
    ['Overhand Grip Cable Lat Pulldown', 'other', ['Lat Pulldown']],
    ['Underhand Grip Cable Lat Pulldown', 'other', []],
    ['Seated Hamstring Curl', 'other', ['Seated Leg Curl']],
    ['Seated Single Leg Hamstring Curl', 'other', []],
    ['Lying Hamstring Curl', 'other', []],
    ['Leg Extension', 'other', []],
    ['45° Leg Press', 'other', ['Leg Press']],
    ['45° Leg Press Calf Raise', 'other', []],
    ['Hack Squat', 'other', []],
    ['Pec Deck Fly', 'other', ['Machine Fly']],
    ['Seated Machine Hip Adduction', 'other', ['Machine Hip Adductor']],
    ['Neutral Grip Pin-Loaded Machine Row', 'other', ['Machine Row']],
    ['Neutral Grip Cable Row', 'other', ['Cable Row']],
    ['Standing Single Arm Cable Row', 'other', ['Seated High Cable Single Rows']],
    ['Single Arm Cable Lateral Raise (With Cable In Front Of Body)', 'other', ['Cable Lateral Raise']],
    ['Single Arm High Cable Lateral Raise', 'other', []],
    ['Seated Machine Lateral Raise', 'other', ['Machine Lateral Raise']],
    ['Cable Straight Bar Triceps Pushdown', 'other', ['Cable Tricep Pushdown']],
    ['Cable Rope Triceps Pushdown', 'other', ['Cable Rope Tricep Extension']],
    ['Cable Straight Bar Overhead Triceps Extension', 'other', ['Cable Rope Overhead Triceps Extension']],
    ['Close Grip EZ Bar Preacher Curl', 'other', ['Preacher Curl']],
    ['Pin-Loaded Machine Preacher Curl', 'other', ['Machine Preacher Curl', 'Machine Bicep Curl']],
    ['Machine Crunch (With Overhead Handles)', 'other', ['Ab Crunch Machine']],
    ['Cable Face Pull', 'other', []],
    ['Close Grip Bench Press', 'other', []],
    ['High Incline Smith Machine Press', 'other', []],
    ['Pin-Loaded Machine Chest Press', 'other', []],
    ['Seated Plate-Loaded Machine Chest Press', 'other', []],
    ['Single Arm Bayesian Curl', 'other', []],
    ['EZ Bar Preacher Reverse Curl', 'other', []],
    ['Machine Bench Press', 'other', []],
    ['Machine Shoulder Press', 'other', []],
    ['Machine Rear Delt Fly', 'other', []],
    ['Smith Machine Bench Press', 'other', []],
    ['Smith Machine Incline Bench Press', 'other', []],
    ['Barbell Bench Press', 'other', []],
    ['Barbell Incline Bench Press', 'other', []],
    ['EZ-Bar Curl', 'other', []],
    ['T-Bar Row', 'other', []],
    ['Romanian Deadlift', 'other', []],
    ['Cable Upright Row', 'other', []],
    ['Behind the Back Cable Bicep Curl', 'other', []],
    ['Seated Tricep Press', 'other', []],
    ['Single Arm Overhead Rope Tricep Extension', 'other', []],
    ['Cable One Arm Underhand Tricep Extension', 'other', []],
    // --- asistované (záporná váha, potřebují tělesnou váhu) ---
    ['Overhand Grip Machine-Assisted Pull-Up', 'assisted', []],
    ['Machine-Assisted Dip', 'assisted', []],
    // --- bez vnější zátěže ---
    ['Bent-Leg Reverse Crunch', 'none', ['Reverse Crunch']],
    ['Decline Reverse Crunch', 'none', []],
    ['Decline Crunch', 'none', []],
    ['Crunches', 'none', []],
    ['Dead Bug', 'none', []],
    ['Bird Dog', 'none', []],
    ['Alternating Heel Touch', 'none', []],
    ['Vertical Leg Raise', 'none', []],
    ['Ab Rollout', 'none', []],
    ['Incline Back Extension', 'none', []],
    ['Push Up', 'none', []],
    ['Push Up on Knees', 'none', []],
    ['Air Squats', 'none', []],
    ['Pull Up', 'none', []],
    ['Dip', 'none', []]
  ];

  const map = new Map();
  for (const [canonical, load, aliases] of TABLE) {
    const entry = { canonical, load };
    map.set(canonical.toLowerCase(), entry);
    for (const a of aliases) map.set(a.toLowerCase(), entry);
  }

  // vrátí { canonical, load, known }; neznámý cvik zůstane pod svým názvem jako typ "other"
  function lookup(name) {
    const e = map.get(String(name).trim().toLowerCase());
    return e ? { canonical: e.canonical, load: e.load, known: true }
             : { canonical: String(name).trim(), load: 'other', known: false };
  }

  return { lookup, TABLE };
})();
if (typeof module !== 'undefined') module.exports = Exercises;