// muscles.js - které svaly cvik zatěžuje (1 = hlavní sval, 0,5 = pomocný)
const Muscles = (() => {
  const LIST = [
    ['chest', 'Chest'], ['lats', 'Lats'], ['shoulders', 'Shoulders'], ['biceps', 'Biceps'],
    ['triceps', 'Triceps'], ['quads', 'Quadriceps'], ['hamstrings', 'Hamstrings']
  ];

  const PRESS = { chest: 1, shoulders: 0.5, triceps: 0.5 };
  const OHP = { shoulders: 1, triceps: 0.5 };
  const PULL = { lats: 1, biceps: 0.5 };
  const CURL = { biceps: 1 };
  const TRI = { triceps: 1 };
  const DELT = { shoulders: 1 };

  const WEIGHTS = {
    // hrudník
    'Dumbbell Bench Press': PRESS,
    '45° Incline Dumbbell Press': PRESS,
    'High Incline Smith Machine Press': PRESS,
    'Pin-Loaded Machine Chest Press': PRESS,
    'Seated Plate-Loaded Machine Chest Press': PRESS,
    'Machine Bench Press': PRESS,
    'Hammerstrength Chest Press': PRESS,
    'Smith Machine Bench Press': PRESS,
    'Smith Machine Incline Bench Press': PRESS,
    'Barbell Bench Press': PRESS,
    'Barbell Incline Bench Press': PRESS,
    'Close Grip Bench Press': { triceps: 1, chest: 0.5 },
    'Pec Deck Fly': { chest: 1 },
    'Dumbbell Fly': { chest: 1 },
    '45° Incline Dumbbell Fly': { chest: 1 },
    // ramena
    'Seated Dumbbell Overhead Press': OHP,
    'Seated Neutral Grip Dumbbell Overhead Press': OHP,
    'Machine Shoulder Press': OHP,
    'Standing Dumbbell Lateral Raise': DELT,
    'Seated Dumbbell Lateral Raise': DELT,
    'Single Arm Cable Lateral Raise (With Cable In Front Of Body)': DELT,
    'Single Arm High Cable Lateral Raise': DELT,
    'Seated Machine Lateral Raise': DELT,
    'Seated Neutral Grip Dumbbell Rear Delt Fly': DELT,
    'Machine Rear Delt Fly': DELT,
    'Cable Face Pull': DELT,
    'Cable Upright Row': DELT,
    // záda
    'Overhand Grip Cable Lat Pulldown': PULL,
    'Underhand Grip Cable Lat Pulldown': PULL,
    'Overhand Grip Machine-Assisted Pull-Up': PULL,
    'Neutral Grip Cable Row': PULL,
    'Standing Single Arm Cable Row': PULL,
    'Neutral Grip Pin-Loaded Machine Row': PULL,
    'Chest-Supported Dumbbell Row (Elbows-In)': PULL,
    'Single Arm Dumbbell Row (Elbow-In)': PULL,
    'T-Bar Row': PULL,
    'Dumbbell Pullover': { lats: 1, chest: 0.5 },
    // biceps
    'Incline Dumbbell Biceps Curl': CURL,
    'Close Grip EZ Bar Preacher Curl': CURL,
    'Pin-Loaded Machine Preacher Curl': CURL,
    'Single Arm Bayesian Curl': CURL,
    'Dumbbell Concentration Curl': CURL,
    'Single Arm Dumbbell Preacher Curl': CURL,
    'Seated Dumbbell Curl': CURL,
    'Dumbbell Bicep Curl': CURL,
    'EZ-Bar Curl': CURL,
    'Behind the Back Cable Bicep Curl': CURL,
    'EZ Bar Preacher Reverse Curl': CURL,
    // triceps
    'Dumbbell Skull Crusher': TRI,
    'Cable Straight Bar Triceps Pushdown': TRI,
    'Cable Rope Triceps Pushdown': TRI,
    'Cable Straight Bar Overhead Triceps Extension': TRI,
    'Cable Rope Overhead Triceps Extension': TRI,
    'Seated Dumbbell Overhead Triceps Extension': TRI,
    'Seated Tricep Press': TRI,
    'Single Arm Overhead Rope Tricep Extension': TRI,
    'Cable One Arm Underhand Tricep Extension': TRI,
    // nohy
    'Leg Extension': { quads: 1 },
    '45° Leg Press': { quads: 1 },
    'Hack Squat': { quads: 1 },
    'Goblet Squat': { quads: 1 },
    'Walking Lunge': { quads: 1, hamstrings: 0.5 },
    'Seated Hamstring Curl': { hamstrings: 1 },
    'Seated Single Leg Hamstring Curl': { hamstrings: 1 },
    'Lying Hamstring Curl': { hamstrings: 1 },
    'Romanian Deadlift': { hamstrings: 1 }
  };

  return { LIST, WEIGHTS };
})();
if (typeof module !== 'undefined') module.exports = Muscles;