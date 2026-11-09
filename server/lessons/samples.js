// One hand-written sample lesson per format (physics: forces and motion). Used by the tests and
// by `npm run preview -- --format=<id>` to check each format's look against real Vidmoat frames
// without spending Claude tokens.

const quiz = { question: 'What happens to an object with zero net force acting on it?', options: ['It slows to a stop', 'It keeps its velocity', 'It speeds up'], answerIndex: 1, explanation: 'No net force means no change in velocity.' };

export const SAMPLES = {
  explain: {
    format: 'explain', subtopic: 'Newton’s first law', title: 'Why a ball keeps rolling', hook: 'Objects don’t want to stop', hookTerm: 'stop',
    ambient: 'rolling ball floor',
    beats: [
      { text: 'Newton’s first law says a moving object keeps moving unless a force acts on it.', keyTerm: 'Inertia', visual: { kind: 'definition', title: 'Inertia', items: ['The tendency of an object to resist any change in its motion.'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'On a rough floor, friction is the force that slows the ball down.', keyTerm: 'Friction', visual: { kind: 'footage', query: 'ball rolling on grass', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Remove friction, as in space, and the ball would roll forever at the same speed.', keyTerm: 'No net force', visual: { kind: 'compare', title: 'Rough floor|Deep space', items: ['Friction acts|No force', 'Ball slows|Ball keeps going', 'Needs a push|Needs nothing'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz, takeaway: 'No net force, no change in motion.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  mythbust: {
    format: 'mythbust', subtopic: 'Heavier falls faster?', title: 'Do heavy things fall faster?', hook: 'Drop a hammer and a feather', hookTerm: 'hammer',
    ambient: 'falling objects slow motion', myth: 'Heavier objects fall faster than light ones', fact: 'Without air, everything falls at the same rate',
    beats: [
      { text: 'Gravity pulls harder on a heavier object, but that object also needs more force to accelerate.', keyTerm: 'Mass cancels', visual: { kind: 'equation', title: 'Acceleration does not depend on mass', items: ['F = m × g', 'a = F ÷ m = g'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'On the Moon in 1971, a hammer and a feather hit the ground together.', keyTerm: 'Apollo 15', visual: { kind: 'photo', query: 'Apollo 15 moon surface', title: '', items: [], value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'A feather falls slower than a stone on Earth because of air resistance.', options: ['Myth', 'Fact', 'Depends'], answerIndex: 1, explanation: 'Air pushes back far more on the feather than on the stone.' },
    takeaway: 'In a vacuum, all objects fall together.', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  rapid: {
    format: 'rapid', subtopic: 'Forces you meet daily', title: '5 forces you felt today', hook: '5 forces you felt today', hookTerm: '5 forces',
    ambient: 'city street people walking',
    items: [
      { title: 'Gravity', text: 'Gravity pulled you towards the Earth every second of the day.', visual: 'jumping person' },
      { title: 'Normal force', text: 'Your chair pushed back up on you with a normal force.', visual: 'person sitting chair' },
      { title: 'Friction', text: 'Friction between shoes and floor let you walk without slipping.', visual: 'walking feet pavement' },
      { title: 'Air resistance', text: 'Air resistance pushed against you as you cycled or ran.', visual: 'cyclist wind' },
      { title: 'Tension', text: 'Tension in a bag strap held your books up all day.', visual: 'backpack strap' },
    ],
    quiz: { question: 'Which force stops your shoes sliding on the floor?', options: ['Gravity', 'Friction', 'Tension'], answerIndex: 1, explanation: 'Friction opposes sliding between surfaces.' },
    takeaway: 'Forces are everywhere, even when nothing moves.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  examdrill: {
    format: 'examdrill', subtopic: 'F = ma problems', title: 'The F = ma question everyone drops marks on', hook: 'This one costs marks every year', hookTerm: 'costs marks',
    ambient: 'exam hall students writing',
    exam: {
      question: 'A 2 kg trolley is pushed with 10 N while friction is 4 N. What is its acceleration?', options: ['5 m/s²', '3 m/s²', '7 m/s²'], answerIndex: 1,
      steps: ['Find the net force: 10 N forward minus 4 N friction gives 6 N.', 'Write Newton’s second law: F equals m times a.', 'Rearrange for a: a equals F over m, so 6 divided by 2.', 'The acceleration is 3 metres per second squared.'],
      mistake: 'Using 10 N instead of the 6 N net force.', tip: 'Always draw the forces and find the resultant before using F = ma.',
    },
    takeaway: 'Net force first, then F = ma.', beats: [], myth: '', fact: '', items: [], cards: [], chat: { contact: '', messages: [] },
    quiz: { question: '', options: [], answerIndex: 0, explanation: '' },
  },
  story: {
    format: 'story', subtopic: 'Newton and the plague year', title: 'The year the plague made physics', hook: 'In 1665 a university closed its doors', hookTerm: '1665',
    ambient: 'old english countryside manor',
    beats: [
      { text: 'Cambridge shut for the plague and 22-year-old Isaac Newton went home to Woolsthorpe.', keyTerm: '1665', visual: { kind: 'photo', query: 'Woolsthorpe Manor', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Alone, he asked why the Moon stays in orbit while an apple falls straight down.', keyTerm: 'The question', visual: { kind: 'photo', query: 'apple tree orchard', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'His answer was that the same gravity pulls on both, weakening with distance squared.', keyTerm: 'The turning point', visual: { kind: 'equation', title: 'Universal gravitation', items: ['F = G m₁ m₂ ÷ r²'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Twenty years later the Principia set out the laws of motion we still use today.', keyTerm: '1687', visual: { kind: 'timeline', title: 'Newton’s years', items: ['1665|Plague closes Cambridge', '1666|Gravity and calculus', '1687|Principia published'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'Why did Newton leave Cambridge in 1665?', options: ['He graduated early', 'The plague closed it', 'He was expelled'], answerIndex: 1, explanation: 'The university closed during the Great Plague.' },
    takeaway: 'One quiet year changed how we see the universe.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  flashcards: {
    format: 'flashcards', subtopic: 'Forces vocabulary', title: 'Forces: say it before it appears', hook: 'Rapid revision: say it before it appears', hookTerm: 'Rapid revision',
    ambient: 'notebook pen desk',
    cards: [
      { q: 'Unit of force?', a: 'The newton (N)' },
      { q: 'Newton’s second law as an equation?', a: 'F = m × a' },
      { q: 'Force that opposes sliding between surfaces?', a: 'Friction' },
      { q: 'Net force on an object moving at constant velocity?', a: 'Zero' },
    ],
    takeaway: 'Four terms every forces question uses.', beats: [], myth: '', fact: '', items: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
    quiz: { question: '', options: [], answerIndex: 0, explanation: '' },
  },
  why: {
    format: 'why', subtopic: 'Seatbelts and inertia', title: 'Why do seatbelts save lives?', hook: 'Why do seatbelts save lives?', hookTerm: 'seatbelts',
    ambient: 'car driving road',
    beats: [
      { text: 'Because your body has inertia: it keeps moving at the car’s speed even when the car stops.', keyTerm: 'Inertia', visual: { kind: 'footage', query: 'car crash test dummy', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Which means something must apply a force to slow you down, or you hit the windscreen.', keyTerm: 'Stopping force', visual: { kind: 'steps', title: 'In a crash', items: ['Car stops in 0.1 s', 'Body keeps moving', 'Belt applies force', 'Body slows safely'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Which means a belt that stretches spreads that force over more time and a wider area.', keyTerm: 'Longer time', visual: { kind: 'equation', title: 'More time, less force', items: ['F = Δp ÷ Δt'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'Why does a stretchy seatbelt reduce injury?', options: ['It stops you faster', 'It increases stopping time', 'It adds inertia'], answerIndex: 1, explanation: 'A longer stopping time means a smaller force.' },
    takeaway: 'So: more stopping time means less force on you.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  chat: {
    format: 'chat', subtopic: 'Weight vs mass', title: 'Wait, weight isn’t mass?', hook: 'Is my weight different on the Moon?', hookTerm: 'Moon',
    ambient: 'phone texting hands',
    chat: {
      contact: 'Tutor Ama',
      messages: [
        'Quick one: would I weigh less on the Moon or is that a myth?',
        'You would. Weight is the pull of gravity on you, and the Moon pulls about a sixth as hard as Earth.',
        'So my mass changes too?',
        'No. Mass is how much stuff you are made of, and that stays the same everywhere.',
        'So weight = mass × gravity, and only gravity changes?',
        'Exactly. W = m × g, with g about 9.8 on Earth and 1.6 on the Moon.',
      ],
    },
    quiz: { question: 'What stays the same when you travel to the Moon?', options: ['Your weight', 'Your mass', 'Both change'], answerIndex: 1, explanation: 'Mass does not depend on gravity.' },
    takeaway: 'Mass is constant; weight depends on gravity.', beats: [], myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' },
  },

  // ---- second-wave formats ----
  levels: {
    format: 'levels', subtopic: 'Momentum at 3 levels', title: 'Momentum for a kid, a student, a professor', hook: 'Momentum, explained three ways', hookTerm: 'three ways',
    ambient: 'bowling ball rolling',
    beats: [
      { text: 'A big truck is harder to stop than a bike going the same speed, and that hardness to stop is momentum.', keyTerm: 'Hard to stop', visual: { kind: 'footage', query: 'truck driving highway', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Momentum is mass times velocity, and in a collision the total momentum before equals the total after.', keyTerm: 'p = m × v', visual: { kind: 'equation', title: 'Conserved in collisions', items: ['p = m × v', 'Σp before = Σp after'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Conservation follows from Newton’s third law: the two forces are equal and opposite, so the impulses cancel.', keyTerm: 'Impulse', visual: { kind: 'steps', title: 'Why it is conserved', items: ['Equal, opposite forces', 'Same contact time', 'Equal, opposite impulses', 'Total momentum unchanged'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'A 2 kg ball at 3 m/s has what momentum?', options: ['1.5 kg·m/s', '6 kg·m/s', '9 kg·m/s'], answerIndex: 1, explanation: 'p = m × v = 2 × 3 = 6 kg·m/s.' },
    takeaway: 'Mass times velocity, and the total never changes.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  spotmistake: {
    format: 'spotmistake', subtopic: 'Kinetic energy slip', title: 'Spot the mistake: kinetic energy', hook: 'One step is wrong. Can you find it?', hookTerm: 'wrong',
    ambient: 'student checking homework',
    exam: {
      question: 'A 4 kg cart moves at 3 m/s. Find its kinetic energy.', options: [], answerIndex: 1,
      steps: ['Write the formula: KE = ½ m v².', 'Substitute: KE = ½ × 4 × 3 = 6 J.', 'So the kinetic energy is 6 joules.'],
      mistake: 'The velocity was not squared: 3² is 9, not 3.', tip: 'KE = ½ × 4 × 3² = ½ × 4 × 9 = 18 J.',
    },
    takeaway: 'Square the speed before you multiply.', beats: [], myth: '', fact: '', items: [], cards: [], chat: { contact: '', messages: [] }, quiz: { question: '', options: [], answerIndex: 0, explanation: '' },
  },
  tierlist: {
    format: 'tierlist', subtopic: 'Forces ranked', title: 'Ranking the forces by exam weight', hook: 'Ranking every force by how often it is examined', hookTerm: 'Ranking',
    ambient: 'physics classroom chalkboard',
    items: [
      { title: 'Tension', tier: 'C', text: 'Tension shows up in pulley questions and almost nowhere else.', visual: 'rope pulley' },
      { title: 'Air resistance', tier: 'B', text: 'Air resistance is the twist examiners add to falling-object questions.', visual: 'skydiver' },
      { title: 'Normal force', tier: 'A', text: 'The normal force hides inside every inclined plane problem.', visual: 'ramp slope' },
      { title: 'Friction', tier: 'A', text: 'Friction appears in half of all net-force calculations.', visual: 'tyre skid' },
      { title: 'Gravity', tier: 'S', text: 'Gravity is in every single mechanics question, full stop.', visual: 'apple falling' },
    ],
    quiz: { question: 'Which force is in every mechanics question?', options: ['Tension', 'Gravity', 'Air resistance'], answerIndex: 1, explanation: 'Weight is always acting, so gravity is always there.' },
    takeaway: 'Learn gravity and friction first.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  thisorthat: {
    format: 'thisorthat', subtopic: 'Mixed-up pairs', title: 'Mass or weight? Speed or velocity?', hook: 'Four pairs students mix up every year', hookTerm: 'mix up',
    ambient: 'two doors choice',
    items: [
      { title: 'Mass|Weight', tier: '', text: 'Mass is how much stuff, weight is the pull of gravity on it.', visual: 'scales weighing' },
      { title: 'Speed|Velocity', tier: '', text: 'Velocity has a direction, speed does not.', visual: 'car speedometer' },
      { title: 'Distance|Displacement', tier: '', text: 'Displacement is the straight line from start to finish, distance is the path.', visual: 'hiking trail map' },
      { title: 'Elastic|Inelastic', tier: '', text: 'Elastic collisions keep kinetic energy, inelastic ones lose some.', visual: 'billiard balls' },
    ],
    quiz: { question: 'Which quantity has a direction?', options: ['Speed', 'Velocity', 'Mass'], answerIndex: 1, explanation: 'Velocity is a vector; speed is its size.' },
    takeaway: 'Vectors have direction; scalars do not.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  pov: {
    format: 'pov', subtopic: 'POV: a photon', title: 'POV: you are a photon leaving the Sun', hook: 'POV: you are a photon leaving the Sun', hookTerm: 'photon',
    ambient: 'sun surface flare',
    beats: [
      { text: 'You are born in the core and spend thousands of years bouncing your way to the surface.', keyTerm: 'The core', visual: { kind: 'footage', query: 'sun surface plasma', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'You finally escape and cross 150 million kilometres of space in eight minutes.', keyTerm: '8 minutes', visual: { kind: 'stat', title: 'Minutes from Sun to Earth', items: [], value: 8, unit: '', query: '', svg: '' } },
      { text: 'You hit a leaf, a chlorophyll molecule catches you, and your energy becomes sugar.', keyTerm: 'Photosynthesis', visual: { kind: 'footage', query: 'sunlight through leaves', title: '', items: [], value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'How long does light take from the Sun to Earth?', options: ['8 seconds', '8 minutes', '8 hours'], answerIndex: 1, explanation: '150 million km at 300,000 km/s is about 500 s.' },
    takeaway: 'Sunlight is eight minutes old when it reaches you.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  hottake: {
    format: 'hottake', subtopic: 'Friction defended', title: 'Hot take: friction is the most useful force', hook: 'Friction is not your enemy', hookTerm: 'enemy',
    ambient: 'shoes walking pavement', myth: 'Friction is the most useful force in physics', fact: 'Without friction you could not walk, drive or hold a pen',
    beats: [
      { text: 'Every step you take pushes back on the ground, and friction is what pushes you forward.', keyTerm: 'Walking', visual: { kind: 'footage', query: 'walking shoes close up', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Car tyres grip the road only because of friction, which is why ice is dangerous.', keyTerm: 'Grip', visual: { kind: 'compare', title: 'Dry road|Ice', items: ['High friction|Almost none', 'Short stop|Long slide'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'What force lets a tyre push a car forward?', options: ['Gravity', 'Friction', 'Tension'], answerIndex: 1, explanation: 'The road’s friction on the tyre is the forward force.' },
    takeaway: 'Friction resists sliding, and that is exactly what makes motion possible.', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  countdown: {
    format: 'countdown', subtopic: 'Exam top 3', title: 'The 3 forces questions on every exam', hook: 'The 3 questions that will be on your exam', hookTerm: 'exam',
    ambient: 'exam paper pen',
    items: [
      { title: 'Resultant force', tier: '', text: 'Add the forces as vectors and you will be asked for the resultant every time.', visual: 'tug of war' },
      { title: 'F = ma', tier: '', text: 'Newton’s second law appears in a calculation on every paper.', visual: 'rocket launch' },
      { title: 'Free-body diagrams', tier: '', text: 'Draw the forces on one object and half the marks are already yours.', visual: 'student drawing diagram' },
    ],
    quiz: { question: 'What earns marks before any calculation?', options: ['A free-body diagram', 'A calculator', 'A ruler'], answerIndex: 0, explanation: 'Examiners award marks for a correct diagram.' },
    takeaway: 'Diagram first, then F = ma.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  speedrun: {
    format: 'speedrun', subtopic: 'Forces in 30 s', title: 'Forces and motion in 30 seconds', hook: 'Forces and motion in 30 seconds. Go.', hookTerm: '30 seconds',
    ambient: 'stopwatch timer',
    items: [
      { title: 'Newton 1', tier: '', text: 'No net force, no change in motion.', visual: 'ice skater gliding' },
      { title: 'Newton 2', tier: '', text: 'Force equals mass times acceleration.', visual: 'rocket launch' },
      { title: 'Newton 3', tier: '', text: 'Every force has an equal, opposite partner.', visual: 'swimmer pushing wall' },
      { title: 'Weight', tier: '', text: 'Weight is mass times g.', visual: 'scales' },
      { title: 'Friction', tier: '', text: 'Friction opposes sliding between surfaces.', visual: 'brake disc' },
      { title: 'Momentum', tier: '', text: 'Momentum is conserved in collisions.', visual: 'billiard balls' },
    ],
    quiz: { question: 'Which law pairs every force with an opposite one?', options: ['First', 'Second', 'Third'], answerIndex: 2, explanation: 'Newton’s third law: action and reaction.' },
    takeaway: 'Three laws, weight, friction, momentum.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  guess: {
    format: 'guess', subtopic: 'Feather vs hammer', title: 'Guess first: which lands first on the Moon?', hook: 'Most students get this wrong', hookTerm: 'wrong',
    ambient: 'moon surface',
    exam: { question: 'On the Moon, a hammer and a feather are dropped together. Which lands first?', options: ['The hammer', 'The feather', 'Both together'], answerIndex: 2, steps: [], mistake: '', tip: 'Without air, everything falls at the same rate.' },
    beats: [
      { text: 'Gravity accelerates every object equally; mass cancels out of the equation.', keyTerm: 'a = g', visual: { kind: 'equation', title: 'Mass cancels', items: ['F = m g', 'a = F ÷ m = g'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'On Earth the feather falls slower only because air pushes back on it far more than on the hammer.', keyTerm: 'Air resistance', visual: { kind: 'footage', query: 'feather falling slow motion', title: '', items: [], value: 0, unit: '', svg: '' } },
    ],
    takeaway: 'No air, no difference.', myth: '', fact: '', items: [], cards: [], chat: { contact: '', messages: [] }, quiz: { question: '', options: [], answerIndex: 0, explanation: '' },
  },
  wyr: {
    format: 'wyr', subtopic: 'Seatbelt dilemma', title: 'Would you rather stop in 0.1 s or 1 s?', hook: 'Would you rather stop in a tenth of a second, or a full second?', hookTerm: 'full second',
    ambient: 'car braking',
    quiz: { question: 'Would you rather stop in 0.1 s or 1 s at the same speed?', options: ['0.1 seconds', '1 second', 'Depends on the case'], answerIndex: 1, explanation: 'Same momentum change over more time means less force on you.' },
    beats: [
      { text: 'Your change in momentum is fixed by your speed, so the only thing you control is the time it takes.', keyTerm: 'Impulse', visual: { kind: 'equation', title: 'More time, less force', items: ['F × t = Δp', 'F = Δp ÷ t'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Crumple zones, airbags and helmets all work by stretching the stop over more time.', keyTerm: 'Crumple zones', visual: { kind: 'footage', query: 'car crash test', title: '', items: [], value: 0, unit: '', svg: '' } },
    ],
    takeaway: 'Stretch the stop, shrink the force.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },

  // ---- third-wave formats ----
  onething: {
    format: 'onething', subtopic: 'Terminal velocity', title: 'One thing about falling', hook: 'One thing about falling', hookTerm: 'falling', hookStyle: 'curiosity',
    ambient: 'skydiver falling',
    beats: [{ text: 'A falling object stops speeding up once air resistance equals its weight, and that speed is terminal velocity.', keyTerm: 'Terminal velocity', visual: { kind: 'definition', title: 'Terminal velocity', items: ['The steady speed reached when air resistance balances weight.'], query: '', value: 0, unit: '', svg: '' } }],
    quiz: { question: 'At terminal velocity, acceleration is…', options: ['Zero', '9.8 m/s²', 'Increasing'], answerIndex: 0, explanation: 'Forces balance, so no acceleration.' },
    takeaway: 'Balanced forces, steady speed.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  cheatsheet: {
    format: 'cheatsheet', subtopic: 'Motion formulas', title: 'Motion on one card', hook: 'Motion on one card', hookTerm: 'one card', hookStyle: 'claim',
    ambient: 'notebook formulas desk',
    items: [
      { title: 'v = u + at', tier: '', text: 'Final velocity from initial velocity, acceleration and time.', visual: 'car accelerating' },
      { title: 's = ut + ½at²', tier: '', text: 'Distance covered when you know the time.', visual: 'runner track' },
      { title: 'v² = u² + 2as', tier: '', text: 'Use this when time is not given.', visual: 'braking car' },
      { title: 'F = ma', tier: '', text: 'Net force equals mass times acceleration.', visual: 'rocket launch' },
      { title: 'W = mg', tier: '', text: 'Weight is mass times gravitational field strength.', visual: 'scales weighing' },
    ],
    quiz: { question: 'Which equation needs no time value?', options: ['v = u + at', 'v² = u² + 2as', 's = ut + ½at²'], answerIndex: 1, explanation: 'It links velocities, acceleration and distance only.' },
    takeaway: 'Pick the equation by what you are not given.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  predict: {
    format: 'predict', subtopic: 'Inertia tablecloth', title: 'What happens to the plates?', hook: 'Watch the tablecloth', hookTerm: 'tablecloth', hookStyle: 'question',
    ambient: 'tablecloth pull trick',
    exam: { question: 'The tablecloth is yanked fast. What happens to the plates?', options: ['They fly off', 'They stay put', 'They shatter'], answerIndex: 1, steps: [], mistake: '', tip: 'Objects keep doing what they were doing unless a force acts long enough.' },
    beats: [
      { text: 'The plates have inertia, and the quick pull gives friction almost no time to drag them along.', keyTerm: 'Inertia', visual: { kind: 'footage', query: 'tablecloth pull plates', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Pull slowly and friction acts for longer, so the plates come with the cloth.', keyTerm: 'Time matters', visual: { kind: 'compare', title: 'Fast pull|Slow pull', items: ['Tiny impulse|Large impulse', 'Plates stay|Plates move'], query: '', value: 0, unit: '', svg: '' } },
    ],
    takeaway: 'Short force, small effect.', myth: '', fact: '', items: [], cards: [], chat: { contact: '', messages: [] }, quiz: { question: '', options: [], answerIndex: 0, explanation: '' },
  },
  analogy: {
    format: 'analogy', subtopic: 'Voltage as pressure', title: 'Voltage is like water pressure', hook: 'Voltage is like water pressure', hookTerm: 'water pressure', hookStyle: 'claim',
    ambient: 'water pipes flowing',
    beats: [
      { text: 'Imagine a water tank on a roof: the higher the tank, the harder the water pushes through the pipes.', keyTerm: 'The tank', visual: { kind: 'footage', query: 'water tower pipe', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'So the push is voltage, the flow is current and the narrow pipe is resistance.', keyTerm: 'The mapping', visual: { kind: 'compare', title: 'Analogy|Real thing', items: ['Pressure|Voltage', 'Flow rate|Current', 'Narrow pipe|Resistance'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'But electrons do not get used up like water: the same charge flows all the way round the circuit.', keyTerm: 'Where it breaks', visual: { kind: 'steps', title: 'The real detail', items: ['Charge is conserved', 'Energy is transferred', 'Current is the same in series'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'In the water analogy, resistance is…', options: ['The pump', 'A narrow pipe', 'The water'], answerIndex: 1, explanation: 'A narrow pipe resists flow like resistance resists current.' },
    takeaway: 'Push, flow, narrowness: voltage, current, resistance.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  mistakes: {
    format: 'mistakes', subtopic: 'Forces exam slips', title: '3 mistakes that cost marks in forces', hook: '3 mistakes that cost marks in forces', hookTerm: 'cost marks', hookStyle: 'pain',
    ambient: 'student exam stress',
    items: [
      { title: 'Mixing mass and weight', tier: '', text: 'Weight is a force in newtons; writing kilograms loses the mark, so multiply by g.', visual: 'scales weighing' },
      { title: 'Forgetting friction', tier: '', text: 'The net force is push minus friction; using the push alone gives the wrong acceleration.', visual: 'box pushed floor' },
      { title: 'No diagram', tier: '', text: 'A free-body diagram earns marks on its own and stops you missing a force.', visual: 'student drawing diagram' },
    ],
    quiz: { question: 'Which of these is a mistake?', options: ['Weight in newtons', 'Weight in kilograms', 'Drawing the forces'], answerIndex: 1, explanation: 'Weight is a force, measured in newtons.' },
    takeaway: 'Newtons, net force, diagram.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  history: {
    format: 'history', subtopic: 'Gravity through time', title: 'From apples to black holes', hook: 'How we got from apples to black holes', hookTerm: 'black holes', hookStyle: 'story',
    ambient: 'old observatory telescope',
    items: [
      { title: '1687|Principia', tier: '', text: 'Newton publishes universal gravitation: one law for apples and planets.', visual: 'Isaac Newton portrait' },
      { title: '1859|Mercury’s wobble', tier: '', text: 'Astronomers find Mercury’s orbit drifting in a way Newton cannot explain.', visual: 'planet Mercury' },
      { title: '1915|General relativity', tier: '', text: 'Einstein recasts gravity as curved spacetime and the wobble is solved.', visual: 'Albert Einstein portrait' },
      { title: '2019|First image', tier: '', text: 'The Event Horizon Telescope photographs a black hole’s shadow.', visual: 'black hole image' },
    ],
    quiz: { question: 'What did Newton’s law fail to explain?', options: ['Falling apples', 'Mercury’s orbit drift', 'The Moon'], answerIndex: 1, explanation: 'Mercury’s perihelion shift needed relativity.' },
    takeaway: 'Each theory explained the last one’s leftover puzzle.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  challenge: {
    format: 'challenge', subtopic: 'Mental physics', title: 'Ten seconds: the braking car', hook: 'Ten seconds. Go.', hookTerm: 'Ten seconds', hookStyle: 'challenge',
    ambient: 'stopwatch close up',
    exam: { question: 'A car slows from 20 m/s to 0 in 4 s. Its deceleration?', options: ['4 m/s²', '5 m/s²', '80 m/s²'], answerIndex: 1, steps: ['Change in velocity is 20 m/s over 4 s.', '20 divided by 4 gives 5 m/s².'], mistake: '', tip: 'Acceleration is change in velocity over time: divide, do not multiply.' },
    takeaway: 'Divide the change by the time.', beats: [], myth: '', fact: '', items: [], cards: [], chat: { contact: '', messages: [] }, quiz: { question: '', options: [], answerIndex: 0, explanation: '' },
  },
  // ---- fourth-wave formats ----
  eli5: {
    format: 'eli5', subtopic: 'Inertia, two ways', title: 'Inertia, like you are five', hook: 'Inertia, like you are five', hookTerm: 'five', hookStyle: 'curiosity',
    ambient: 'skateboard rolling street',
    beats: [
      { text: 'Push a toy car and it keeps rolling until the carpet or a wall makes it stop; it is lazy about changing.', keyTerm: 'Lazy car', visual: { kind: 'footage', query: 'toy car rolling floor', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Inertia is an object’s resistance to any change in velocity, and it grows with mass, so heavier things resist more.', keyTerm: 'Inertia', visual: { kind: 'definition', title: 'Inertia', items: ['The tendency of an object to resist a change in its state of motion; proportional to mass.'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'Which object has the most inertia?', options: ['A tennis ball', 'A bowling ball', 'A balloon'], answerIndex: 1, explanation: 'More mass means more resistance to changing motion.' },
    takeaway: 'Things keep doing what they are doing; mass makes them stubborn.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  mnemonic: {
    format: 'mnemonic', subtopic: 'Equations of motion', title: 'Never forget the SUVAT letters again', hook: 'Never forget SUVAT again', hookTerm: 'SUVAT', hookStyle: 'secret',
    ambient: 'notebook pen desk',
    fact: 'Some Unicorns Vanish At Twilight',
    items: [
      { title: 'Some|s, displacement', tier: '', text: 'S is displacement, how far the object ends up from where it started.', visual: 'running track distance' },
      { title: 'Unicorns|u, initial velocity', tier: '', text: 'U is the velocity at the start of the motion you are looking at.', visual: 'sprinter start blocks' },
      { title: 'Vanish|v, final velocity', tier: '', text: 'V is the velocity at the end of that stretch of motion.', visual: 'sprinter finish line' },
      { title: 'At|a, acceleration', tier: '', text: 'A is how quickly the velocity changes, in metres per second squared.', visual: 'car accelerating' },
      { title: 'Twilight|t, time', tier: '', text: 'T is the time the motion takes, in seconds.', visual: 'stopwatch' },
    ],
    quiz: { question: 'In SUVAT, what does the letter u stand for?', options: ['Final velocity', 'Initial velocity', 'Unit'], answerIndex: 1, explanation: 'u is the velocity at the start.' },
    takeaway: 'Five letters, every motion question.', beats: [], myth: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  realworld: {
    format: 'realworld', subtopic: 'Friction around you', title: 'Friction on the way home', hook: 'You will meet friction on the way home', hookTerm: 'way home', hookStyle: 'claim',
    ambient: 'busy street evening',
    items: [
      { title: 'Your shoes', tier: '', text: 'Every step pushes back on the ground, and friction is what stops your foot sliding.', visual: 'walking shoes pavement' },
      { title: 'Trotro brakes', tier: '', text: 'Brake pads squeeze the wheel and friction turns the bus’s motion into heat.', visual: 'bus brakes city' },
      { title: 'Striking a match', tier: '', text: 'Rubbing the match head generates enough heat from friction to start the flame.', visual: 'striking match' },
    ],
    quiz: { question: 'Which everyday event relies on friction?', options: ['A satellite orbiting', 'A match lighting', 'A ball falling'], answerIndex: 1, explanation: 'The rub heats the match head.' },
    takeaway: 'Friction is the force you use all day without noticing.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  whatif: {
    format: 'whatif', subtopic: 'A world without friction', title: 'What if friction switched off?', hook: 'What if friction switched off tomorrow', hookTerm: 'switched off', hookStyle: 'question',
    ambient: 'ice rink skating',
    beats: [
      { text: 'You could not walk: your foot would slide back as hard as you pushed, like standing on perfect ice.', keyTerm: 'No grip', visual: { kind: 'footage', query: 'person slipping on ice', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Nothing would stay put: knots, screws and brakes all depend on surfaces gripping each other.', keyTerm: 'Nothing holds', visual: { kind: 'steps', title: 'What friction holds together', items: ['Knots and laces', 'Screws and nails', 'Brakes', 'Your grip on a cup'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Yet moving things would coast forever, which is exactly what Newton’s first law describes.', keyTerm: 'First law', visual: { kind: 'definition', title: 'Newton’s first law', items: ['An object keeps its velocity unless a net force acts on it.'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'Without friction, a rolling ball on a flat floor would…', options: ['Stop sooner', 'Keep rolling', 'Speed up'], answerIndex: 1, explanation: 'No net force, so velocity stays the same.' },
    takeaway: 'Friction costs energy but lets you grip, stop and build.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  wow: {
    format: 'wow', subtopic: 'Weight on other worlds', title: 'You would weigh a sixth on the Moon', hook: 'Your bathroom scale is lying to you', hookTerm: 'lying', hookStyle: 'claim',
    ambient: 'moon surface astronaut',
    fact: 'On the Moon you would weigh about one sixth of what you weigh on Earth',
    beats: [
      { text: 'Weight is the pull of gravity on your mass, and the Moon pulls about six times more weakly than Earth.', keyTerm: 'Weight = m × g', visual: { kind: 'equation', title: 'Weight depends on gravity', items: ['W = m × g', 'g(Earth) ≈ 9.8 N/kg', 'g(Moon) ≈ 1.6 N/kg'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Your mass has not changed at all, which is why astronauts bounce but still need the same effort to push a crate.', keyTerm: 'Same mass', visual: { kind: 'photo', query: 'astronaut jumping on moon', title: '', items: [], value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'What changes when you stand on the Moon?', options: ['Your mass', 'Your weight', 'Both'], answerIndex: 1, explanation: 'Gravity is weaker, so weight drops; mass stays.' },
    takeaway: 'Weight follows gravity; mass follows you.', myth: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  beforeafter: {
    format: 'beforeafter', subtopic: 'Before Newton', title: 'Before and after Newton’s laws', hook: 'Before Newton, motion needed a push to continue', hookTerm: 'Before Newton', hookStyle: 'story',
    ambient: 'old library books',
    beats: [
      { text: 'For two thousand years people believed moving things slow down naturally and need a constant push to keep going.', keyTerm: 'Aristotle’s physics', visual: { kind: 'compare', title: 'Before|After', items: ['Motion needs a push|Motion continues by itself', 'Heavy falls faster|All fall alike in a vacuum', 'Planets need movers|Gravity does it'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Newton showed that forces change motion rather than cause it, and the same rule works for apples and planets.', keyTerm: 'Forces change motion', visual: { kind: 'definition', title: 'Newton’s first law', items: ['An object keeps its velocity unless a net force acts on it.'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'According to Newton, what does a force do?', options: ['Keeps motion going', 'Changes motion', 'Creates mass'], answerIndex: 1, explanation: 'A net force changes velocity; no force, no change.' },
    takeaway: 'Forces change motion; they do not keep it going.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  truefalse: {
    format: 'truefalse', subtopic: 'Forces: true or false', title: 'True or false: forces edition', hook: 'True or false: heavier things fall faster', hookTerm: 'True or false', hookStyle: 'challenge',
    ambient: 'quiz show lights',
    cards: [
      { q: 'A moving object needs a force to keep moving.', a: 'False: with no net force it keeps its velocity.' },
      { q: 'Weight is measured in newtons.', a: 'True: weight is a force.' },
      { q: 'Action and reaction act on the same object.', a: 'False: they act on two different objects.' },
      { q: 'Heavier things fall faster.', a: 'False: in a vacuum everything falls at the same rate.' },
    ],
    takeaway: 'Four myths down.', beats: [], myth: '', fact: '', items: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
    quiz: { question: '', options: [], answerIndex: 0, explanation: '' },
  },
  // ---- third-wave formats ----
  detective: {
    format: 'detective', subtopic: 'Seatbelts and inertia', title: 'The case of the sudden stop', hook: 'Why do passengers lurch forward when a bus brakes?', hookTerm: 'lurch forward',
    ambient: 'bus interior city',
    beats: [
      { text: 'Clue one: before braking, you and the bus were moving forward at the same speed.', keyTerm: 'Same speed', visual: { kind: 'footage', query: 'bus driving city street', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Clue two: the brakes push on the bus, not on you.', keyTerm: 'Force on the bus', visual: { kind: 'compare', title: 'Bus|You', items: ['Brakes act|No force yet', 'Slows down|Keeps going'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Clue three: an object keeps its motion unless a force acts on it.', keyTerm: 'Inertia', visual: { kind: 'definition', title: 'Inertia', items: ['The tendency of an object to keep its state of motion.'], query: '', value: 0, unit: '', svg: '' } },
    ],
    fact: 'Your body keeps moving forward while the bus slows beneath you',
    quiz: { question: 'Why does a cup slide forward on a braking train table?', options: ['The train pushes it', 'It keeps moving forward', 'Air pushes it'], answerIndex: 1, explanation: 'The cup keeps its motion while the train slows.' },
    takeaway: 'Nothing pushes you forward: you just keep going.', myth: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  teachback: {
    format: 'teachback', subtopic: 'Newton’s second law', title: 'Explain F = ma in one sentence', hook: 'In 40 seconds you will be able to explain F = ma', hookTerm: 'F = ma',
    ambient: 'pushing shopping trolley',
    beats: [
      { text: 'A bigger push makes a trolley speed up faster.', keyTerm: 'More force', visual: { kind: 'footage', query: 'pushing shopping trolley', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'A heavier trolley speeds up more slowly for the same push.', keyTerm: 'More mass', visual: { kind: 'equation', title: 'Force equals mass times acceleration', items: ['F = m × a', 'a = F ÷ m'], query: '', value: 0, unit: '', svg: '' } },
    ],
    fact: 'Acceleration grows with force and shrinks with mass',
    quiz: { question: 'Double the mass, same push: what happens to the acceleration?', options: ['It doubles', 'It halves', 'It stays the same'], answerIndex: 1, explanation: 'a = F ÷ m, so doubling m halves a.' },
    takeaway: 'Push harder, go faster; heavier, go slower.', myth: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  numbers: {
    format: 'numbers', subtopic: 'Speeds in physics', title: 'Speed, by the numbers', hook: 'How fast are you moving right now?', hookTerm: 'How fast',
    ambient: 'earth from space',
    beats: [
      { text: 'Earth spins you round at about 1,670 kilometres an hour at the equator.', keyTerm: 'Spin', visual: { kind: 'stat', title: 'Equator spin speed', items: [], value: 1670, unit: ' km/h', query: '', svg: '' } },
      { text: 'Earth orbits the Sun at about 107,000 kilometres an hour.', keyTerm: 'Orbit', visual: { kind: 'stat', title: 'Orbital speed', items: [], value: 107000, unit: ' km/h', query: '', svg: '' } },
      { text: 'Compared with a sprinter or a jet, those speeds are enormous.', keyTerm: 'For scale', visual: { kind: 'bars', title: 'Top speeds in km/h', items: ['Sprinter|44', 'Cheetah|110', 'Jet|900'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'Roughly how fast does Earth orbit the Sun?', options: ['1,670 km/h', '107,000 km/h', '900 km/h'], answerIndex: 1, explanation: 'About 30 km every second.' },
    takeaway: 'Standing still is never really still.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  zoom: {
    format: 'zoom', subtopic: 'Friction up close', title: 'Zoom into friction', hook: 'Zoom in on two "smooth" surfaces', hookTerm: 'Zoom in',
    ambient: 'microscope surface texture',
    beats: [
      { text: 'A polished table looks perfectly smooth to your eye.', keyTerm: 'Your eye', visual: { kind: 'photo', query: 'polished wooden table', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Under a microscope the surface is full of bumps and dips.', keyTerm: '×100', visual: { kind: 'footage', query: 'microscope rough surface', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Those bumps catch on each other, and that resistance is friction.', keyTerm: 'Friction', visual: { kind: 'definition', title: 'Friction', items: ['A force that opposes sliding between two surfaces in contact.'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'What causes friction between two surfaces?', options: ['Tiny bumps catching', 'Magnetism', 'Air pressure'], answerIndex: 0, explanation: 'Microscopic roughness resists sliding.' },
    takeaway: 'Smooth is only smooth from far away.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  interview: {
    format: 'interview', subtopic: 'Gravity', title: 'An interview with gravity', hook: 'Gravity, why do you never take a day off?', hookTerm: 'Gravity',
    ambient: 'falling apple tree',
    chat: {
      contact: 'Gravity',
      messages: [
        'Gravity, why do you never take a day off?',
        'Because every bit of mass pulls on every other bit, all the time.',
        'So you pull on me and I pull on Earth?',
        'Exactly, with equal force; Earth just has far more mass, so you move, not it.',
        'And on the Moon you are weaker?',
        'There I pull about a sixth as hard, so you would weigh much less.',
      ],
    },
    quiz: { question: 'Why do you fall towards Earth, not Earth towards you?', options: ['Earth pulls harder', 'Earth has far more mass', 'You have no mass'], answerIndex: 1, explanation: 'Equal forces, but Earth’s huge mass barely accelerates.' },
    takeaway: 'Gravity is a two-way pull between masses.', beats: [], myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' },
  },
  debate: {
    format: 'debate', subtopic: 'Town speed limits', title: 'Should speed limits be lower in towns?', hook: 'Should town speed limits drop to 30?', hookTerm: '30',
    ambient: 'town street traffic',
    beats: [
      { text: 'For: stopping distance grows fast with speed, so slower cars stop in time.', keyTerm: 'Stopping distance', visual: { kind: 'bars', title: 'Stopping distance in metres', items: ['30 km/h|13', '50 km/h|25'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Against: journeys take longer, which costs people time every day.', keyTerm: 'Journey time', visual: { kind: 'footage', query: 'traffic jam city', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'For: a crash at lower speed carries far less kinetic energy.', keyTerm: 'Kinetic energy', visual: { kind: 'equation', title: 'Energy grows with the square of speed', items: ['KE = ½ m v²'], query: '', value: 0, unit: '', svg: '' } },
      { text: 'Against: on wide, empty roads a lower limit may add little safety.', keyTerm: 'Road design', visual: { kind: 'footage', query: 'wide empty road', title: '', items: [], value: 0, unit: '', svg: '' } },
    ],
    fact: 'Lower limits save lives most on busy streets with people walking',
    quiz: { question: 'Why does halving speed cut crash energy by about three quarters?', options: ['Energy depends on v²', 'Mass halves too', 'Friction doubles'], answerIndex: 0, explanation: 'KE = ½ m v², so half the speed gives a quarter of the energy.' },
    takeaway: 'Speed’s square is what makes crashes deadly.', myth: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  connect: {
    format: 'connect', subtopic: 'Momentum everywhere', title: 'What do footballs and rockets share?', hook: 'What do a football and a rocket have in common?', hookTerm: 'in common',
    ambient: 'rocket launch',
    beats: [
      { text: 'Here: a kicked ball moves off because momentum passes from foot to ball.', keyTerm: 'Momentum', visual: { kind: 'footage', query: 'football kick slow motion', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'Also here: a rocket pushes gas down, and the gas pushes the rocket up.', keyTerm: 'Rockets', visual: { kind: 'footage', query: 'rocket launch', title: '', items: [], value: 0, unit: '', svg: '' } },
      { text: 'The link: in every push, the total momentum before equals the total after.', keyTerm: 'Conservation', visual: { kind: 'compare', title: 'Football|Rocket', items: ['Foot pushes ball|Rocket pushes gas', 'Ball gains momentum|Rocket gains momentum'], query: '', value: 0, unit: '', svg: '' } },
    ],
    quiz: { question: 'What stays the same before and after a push?', options: ['Total speed', 'Total momentum', 'Total mass moving'], answerIndex: 1, explanation: 'Momentum is conserved in every interaction.' },
    takeaway: 'Every push trades momentum, from feet to rockets.', myth: '', fact: '', items: [], cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
  howto: {
    format: 'howto', subtopic: 'Resultant force', title: 'How to find a resultant force', hook: 'How to find a resultant force in 4 steps', hookTerm: '4 steps',
    ambient: 'tug of war rope',
    items: [
      { title: 'Step 1: draw the forces', text: 'Draw every force on the object as an arrow from its centre.', visual: 'drawing arrows paper' },
      { title: 'Step 2: pick a direction', text: 'Choose one direction as positive, usually right or up.', visual: 'pointing direction arrow' },
      { title: 'Step 3: add with signs', text: 'Add forces in that direction and subtract forces against it.', visual: 'calculator homework' },
      { title: 'Step 4: state the answer', text: 'Give the size and the direction, with newtons as the unit.', visual: 'student writing answer' },
    ],
    quiz: { question: '10 N right and 4 N left: what is the resultant?', options: ['14 N right', '6 N right', '6 N left'], answerIndex: 1, explanation: '10 − 4 = 6 N, towards the bigger force.' },
    takeaway: 'Arrows, a direction, add with signs, then say which way.', beats: [], myth: '', fact: '', cards: [], exam: { question: '', options: [], answerIndex: 0, steps: [], mistake: '', tip: '' }, chat: { contact: '', messages: [] },
  },
};
