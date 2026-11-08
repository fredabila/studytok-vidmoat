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
};
