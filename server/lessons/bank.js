// Hand-written lessons used when no Anthropic credentials are configured (and as a fallback when
// a Claude call fails). Two per topic. Facts are deliberately well established and rounded.

export const BANK = {
  biology: [
    {
      subtopic: 'Red blood cells', title: 'Your body is a blood factory',
      hook: 'Your body makes about 2 million red blood cells every second', hookTerm: '2 million',
      beats: [
        { text: 'They are built in the bone marrow, the soft tissue inside your larger bones.', keyTerm: 'Bone marrow', visual: 'red blood cells' },
        { text: 'Each one carries oxygen using hemoglobin, an iron-rich protein that makes blood red.', keyTerm: 'Hemoglobin', visual: 'blood flow' },
        { text: 'A red cell lives about 120 days before the spleen and liver recycle it.', keyTerm: '120 days', visual: 'human body anatomy' },
      ],
      quiz: { question: 'Where are red blood cells made?', options: ['The heart', 'Bone marrow', 'The lungs'], answerIndex: 1 },
      takeaway: 'Your marrow rebuilds your blood every few months',
    },
    {
      subtopic: 'Mitochondria', title: 'Why mitochondria have their own DNA',
      hook: 'Part of every cell in your body was once a free-living bacterium', hookTerm: 'bacterium',
      beats: [
        { text: 'Mitochondria turn food and oxygen into ATP, the energy currency your cells spend.', keyTerm: 'ATP', visual: 'cells microscope' },
        { text: 'They carry their own small loop of DNA, separate from the DNA in the nucleus.', keyTerm: 'Own DNA', visual: 'dna strand' },
        { text: 'Endosymbiosis theory says an ancient cell swallowed a bacterium and the two became partners.', keyTerm: 'Endosymbiosis', visual: 'bacteria microscope' },
      ],
      quiz: { question: 'What do mitochondria mainly produce?', options: ['ATP', 'Insulin', 'Hemoglobin'], answerIndex: 0 },
      takeaway: 'Mitochondria are ancient bacteria that power you',
    },
  ],
  physics: [
    {
      subtopic: 'Speed of light', title: 'You are always looking at the past',
      hook: 'The Sun you see is about 8 minutes old', hookTerm: '8 minutes',
      beats: [
        { text: 'Light travels about 300,000 kilometres every second, fast but not instant.', keyTerm: '300,000 km/s', visual: 'light beam' },
        { text: 'Sunlight crosses 150 million kilometres of space, which takes a little over eight minutes.', keyTerm: '150 million km', visual: 'sun space' },
        { text: 'So every distant object you see is shown as it was when its light set out.', keyTerm: 'Lookback time', visual: 'night sky stars' },
      ],
      quiz: { question: 'How long does sunlight take to reach Earth?', options: ['8 seconds', 'About 8 minutes', 'About 8 hours'], answerIndex: 1 },
      takeaway: 'Looking far away means looking back in time',
    },
    {
      subtopic: 'Inertia', title: 'Why seatbelts actually work',
      hook: 'In a crash your body keeps moving at the speed of the car', hookTerm: 'keeps moving',
      beats: [
        { text: "Newton's first law: objects keep their motion unless a force changes it.", keyTerm: 'Inertia', visual: 'car driving road' },
        { text: 'When a car stops suddenly, nothing has stopped you yet, so you continue forward.', keyTerm: 'First law', visual: 'car brakes' },
        { text: 'A seatbelt applies that stopping force over your strong hips and chest instead of your head.', keyTerm: 'Seatbelt', visual: 'seatbelt car' },
      ],
      quiz: { question: 'Which law explains seatbelts?', options: ["Newton's first law", 'Law of gravity', "Ohm's law"], answerIndex: 0 },
      takeaway: 'Things keep moving until a force stops them',
    },
  ],
  space: [
    {
      subtopic: 'Neutron stars', title: 'The densest thing you can stand on',
      hook: 'A teaspoon of neutron star would weigh billions of tonnes', hookTerm: 'billions of tonnes',
      beats: [
        { text: 'When a giant star explodes as a supernova, its core can collapse into a neutron star.', keyTerm: 'Supernova', visual: 'star explosion' },
        { text: 'It packs more mass than the Sun into a ball about 20 kilometres across.', keyTerm: '20 km wide', visual: 'city aerial' },
        { text: 'Gravity crushes atoms so hard that protons and electrons merge into neutrons.', keyTerm: 'Neutrons', visual: 'galaxy stars' },
      ],
      quiz: { question: 'What forms a neutron star?', options: ['A comet impact', 'A collapsed stellar core', 'A cooling planet'], answerIndex: 1 },
      takeaway: 'Dead star cores can be city-sized and ultra dense',
    },
    {
      subtopic: 'Venus day', title: 'A day longer than a year',
      hook: 'On Venus, a day lasts longer than a year', hookTerm: 'longer',
      beats: [
        { text: 'Venus spins so slowly that one rotation takes about 243 Earth days.', keyTerm: '243 days', visual: 'planet rotating' },
        { text: 'But it orbits the Sun in about 225 Earth days, so its year is shorter.', keyTerm: '225 days', visual: 'solar system' },
        { text: 'It also spins backwards compared with most planets, so the Sun rises in the west.', keyTerm: 'Retrograde', visual: 'sunrise' },
      ],
      quiz: { question: 'Which is longer on Venus?', options: ['Its year', 'Its day', 'They are equal'], answerIndex: 1 },
      takeaway: 'Venus turns once slower than it circles the Sun',
    },
  ],
  history: [
    {
      subtopic: 'Printing press', title: 'The machine that copied ideas',
      hook: 'Before 1450, one book could take months to copy by hand', hookTerm: 'months',
      beats: [
        { text: 'Around 1450 in Mainz, Johannes Gutenberg built a press with movable metal type.', keyTerm: 'Movable type', visual: 'old printing press' },
        { text: 'Printers could now make hundreds of identical copies, and book prices fell sharply.', keyTerm: 'Mass copies', visual: 'old books' },
        { text: 'Cheap print spread new ideas fast, helping fuel the Reformation and the Scientific Revolution.', keyTerm: 'Ideas spread', visual: 'library books' },
      ],
      quiz: { question: 'What did Gutenberg introduce to Europe?', options: ['Paper', 'Movable metal type', 'The alphabet'], answerIndex: 1 },
      takeaway: 'Cheap copies turned ideas into movements',
    },
    {
      subtopic: 'Roman concrete', title: 'Concrete that heals itself',
      hook: 'Some Roman concrete has survived over 2,000 years', hookTerm: '2,000 years',
      beats: [
        { text: 'Romans mixed lime with volcanic ash to make a tough, long-lasting concrete.', keyTerm: 'Volcanic ash', visual: 'roman ruins' },
        { text: 'Recent studies found lime lumps that react with water to seal new cracks.', keyTerm: 'Self-healing', visual: 'ancient stone wall' },
        { text: 'That is one reason structures like the Pantheon dome still stand today.', keyTerm: 'Pantheon', visual: 'pantheon rome' },
      ],
      quiz: { question: 'What did Romans add to their concrete?', options: ['Volcanic ash', 'Steel bars', 'Sea shells only'], answerIndex: 0 },
      takeaway: 'Roman concrete repairs its own cracks',
    },
  ],
  math: [
    {
      subtopic: 'Birthday paradox', title: 'The birthday paradox',
      hook: 'With just 23 people, two likely share a birthday', hookTerm: '23 people',
      beats: [
        { text: 'It feels wrong because you compare yourself to others, not every pair to every pair.', keyTerm: 'Pairs', visual: 'group of friends' },
        { text: 'Twenty-three people make 253 different pairs, and each pair is a chance to match.', keyTerm: '253 pairs', visual: 'birthday party' },
        { text: 'The odds of at least one shared birthday pass fifty percent at that size.', keyTerm: '50 percent', visual: 'calendar' },
      ],
      quiz: { question: 'How many pairs do 23 people form?', options: ['23', '46', '253'], answerIndex: 2 },
      takeaway: 'Count the pairs, not the people',
    },
    {
      subtopic: 'Exponential growth', title: 'Folding paper to the Moon',
      hook: 'Fold paper 42 times and it would reach the Moon', hookTerm: '42 times',
      beats: [
        { text: 'Each fold doubles the thickness, so growth multiplies instead of adding.', keyTerm: 'Doubling', visual: 'folding paper' },
        { text: 'After ten folds, a sheet is about a thousand layers thick.', keyTerm: '1,024 layers', visual: 'stack of paper' },
        { text: 'Keep doubling and a tenth of a millimetre passes 384,000 kilometres by fold 42.', keyTerm: 'Exponential', visual: 'moon night' },
      ],
      quiz: { question: 'What happens with each fold?', options: ['Thickness doubles', 'Adds 1 mm', 'Stays the same'], answerIndex: 0 },
      takeaway: 'Doubling gets huge faster than intuition expects',
    },
  ],
  chemistry: [
    {
      subtopic: 'Water molecule', title: 'Why ice floats',
      hook: 'Most solids sink in their own liquid. Ice floats', hookTerm: 'Ice floats',
      beats: [
        { text: 'Water molecules are bent, with a slightly negative oxygen and positive hydrogens.', keyTerm: 'Polar molecule', visual: 'water drops' },
        { text: 'When water freezes, hydrogen bonds lock molecules into an open hexagonal lattice.', keyTerm: 'Hydrogen bonds', visual: 'ice crystals' },
        { text: 'That lattice takes more space, so ice is less dense than liquid water and floats.', keyTerm: 'Less dense', visual: 'iceberg ocean' },
      ],
      quiz: { question: 'Why does ice float?', options: ['It holds air', 'It is less dense', 'It is colder'], answerIndex: 1 },
      takeaway: 'Frozen water spreads out, so it floats',
    },
    {
      subtopic: 'Rust', title: 'Rust is slow fire',
      hook: 'Rust and fire are the same kind of reaction', hookTerm: 'same',
      beats: [
        { text: 'Both are oxidation: a substance combines with oxygen and releases energy.', keyTerm: 'Oxidation', visual: 'campfire' },
        { text: 'Burning wood oxidises in seconds, giving off heat and light all at once.', keyTerm: 'Fast', visual: 'fire flames' },
        { text: 'Iron with water and oxygen oxidises over months into iron oxide: rust.', keyTerm: 'Iron oxide', visual: 'rusty metal' },
      ],
      quiz: { question: 'What reaction do rust and fire share?', options: ['Oxidation', 'Melting', 'Evaporation'], answerIndex: 0 },
      takeaway: 'Rust is oxidation in slow motion',
    },
  ],
  psychology: [
    {
      subtopic: 'Spacing effect', title: 'Study less, remember more',
      hook: 'Cramming feels efficient but you forget most of it fast', hookTerm: 'forget',
      beats: [
        { text: 'Ebbinghaus showed memories fade quickly at first, then more slowly: the forgetting curve.', keyTerm: 'Forgetting curve', visual: 'student studying' },
        { text: 'Reviewing just as you start to forget makes the memory last much longer.', keyTerm: 'Spaced review', visual: 'calendar notebook' },
        { text: 'Spreading sessions over days beats one long session of the same total time.', keyTerm: 'Spacing effect', visual: 'library study' },
      ],
      quiz: { question: 'What beats cramming for memory?', options: ['Rereading once', 'Spaced review', 'Highlighting'], answerIndex: 1 },
      takeaway: 'Space it out: review right before you forget',
    },
    {
      subtopic: 'Retrieval practice', title: 'Testing yourself is studying',
      hook: 'Quizzing yourself beats rereading your notes', hookTerm: 'Quizzing',
      beats: [
        { text: 'Pulling an answer from memory strengthens the path you will use again later.', keyTerm: 'Retrieval', visual: 'flash cards' },
        { text: 'Rereading feels productive because the text looks familiar, but familiarity is not recall.', keyTerm: 'Familiarity', visual: 'reading notes' },
        { text: 'Even failed attempts help, as long as you check the right answer afterwards.', keyTerm: 'Feedback', visual: 'student exam' },
      ],
      quiz: { question: 'Which study method builds recall best?', options: ['Rereading', 'Self-testing', 'Underlining'], answerIndex: 1 },
      takeaway: 'Close the book and try to recall it',
    },
  ],
  economics: [
    {
      subtopic: 'Compound interest', title: 'Money that makes money',
      hook: 'At 7% a year, money roughly doubles every 10 years', hookTerm: 'doubles',
      beats: [
        { text: 'Compound interest pays interest on your past interest, not just on what you put in.', keyTerm: 'Compounding', visual: 'coins stack' },
        { text: 'The rule of 72: divide 72 by the rate to estimate the years to double.', keyTerm: 'Rule of 72', visual: 'calculator' },
        { text: 'Time matters most, so starting early beats starting big.', keyTerm: 'Start early', visual: 'growing plant' },
      ],
      quiz: { question: 'At 6% a year, money doubles in about…', options: ['6 years', '12 years', '72 years'], answerIndex: 1 },
      takeaway: 'Divide 72 by the rate to find doubling time',
    },
    {
      subtopic: 'Opportunity cost', title: 'The hidden price of every choice',
      hook: 'A free concert ticket still costs you something', hookTerm: 'costs',
      beats: [
        { text: 'Opportunity cost is the value of the best thing you give up when you choose.', keyTerm: 'Opportunity cost', visual: 'crossroads' },
        { text: 'The evening at the concert could have been a paid shift or a night of study.', keyTerm: 'Trade-off', visual: 'concert crowd' },
        { text: 'Good decisions compare options against each other, not just against their price tag.', keyTerm: 'Compare', visual: 'person thinking' },
      ],
      quiz: { question: 'Opportunity cost is the value of…', options: ['The price paid', 'The next best option', 'Taxes owed'], answerIndex: 1 },
      takeaway: 'Every yes is a no to something else',
    },
  ],
  'computer-science': [
    {
      subtopic: 'Binary search', title: 'Find anything in 20 guesses',
      hook: 'You can find one name among a million in 20 guesses', hookTerm: '20 guesses',
      beats: [
        { text: 'Binary search works on sorted lists: check the middle, then drop the half that cannot match.', keyTerm: 'Binary search', visual: 'library shelves' },
        { text: 'Every step halves what is left, so a million shrinks to one in about twenty steps.', keyTerm: 'Halving', visual: 'computer code' },
        { text: 'Its time grows with log n, which is why sorted data is so valuable.', keyTerm: 'Log n', visual: 'data center' },
      ],
      quiz: { question: 'Binary search needs the list to be…', options: ['Sorted', 'Short', 'Random'], answerIndex: 0 },
      takeaway: 'Halve the problem each step',
    },
    {
      subtopic: 'Hash functions', title: 'How sites store your password',
      hook: 'Good websites never store your actual password', hookTerm: 'never',
      beats: [
        { text: 'They store a hash: a scrambled fingerprint made by a one-way function.', keyTerm: 'Hash', visual: 'computer password' },
        { text: 'When you log in, they hash what you type and compare the two fingerprints.', keyTerm: 'Compare', visual: 'typing keyboard' },
        { text: 'A random salt is added first, so identical passwords produce different hashes.', keyTerm: 'Salt', visual: 'server room' },
      ],
      quiz: { question: 'What do good sites store?', options: ['Your password', 'A salted hash', 'Your email only'], answerIndex: 1 },
      takeaway: 'Store fingerprints, never the password',
    },
  ],
  earth: [
    {
      subtopic: 'Plate tectonics', title: 'Your continent is moving',
      hook: 'The Atlantic grows about as fast as your fingernails', hookTerm: 'fingernails',
      beats: [
        { text: "Earth's outer shell is broken into plates floating on hot, slowly flowing rock.", keyTerm: 'Tectonic plates', visual: 'earth from space' },
        { text: 'At the Mid-Atlantic Ridge, new crust forms and pushes the Americas away from Europe and Africa.', keyTerm: 'Seafloor spreading', visual: 'ocean waves' },
        { text: 'Where plates collide or slide, we get mountains, volcanoes and earthquakes.', keyTerm: 'Plate boundaries', visual: 'volcano' },
      ],
      quiz: { question: 'What happens at the Mid-Atlantic Ridge?', options: ['New crust forms', 'Plates melt away', 'Ice builds up'], answerIndex: 0 },
      takeaway: 'Continents drift a few centimetres a year',
    },
    {
      subtopic: 'Greenhouse effect', title: 'The blanket around Earth',
      hook: 'Without any greenhouse effect, Earth would average about -18°C', hookTerm: '-18°C',
      beats: [
        { text: 'Sunlight warms the ground, and the ground gives off heat as infrared light.', keyTerm: 'Infrared', visual: 'sunlight field' },
        { text: 'Gases like carbon dioxide and water vapour absorb some of that heat and send it back down.', keyTerm: 'Greenhouse gases', visual: 'clouds sky' },
        { text: 'Adding more of those gases traps more heat, which is what drives global warming.', keyTerm: 'Global warming', visual: 'melting glacier' },
      ],
      quiz: { question: 'Greenhouse gases mainly trap…', options: ['Visible light', 'Infrared heat', 'Radio waves'], answerIndex: 1 },
      takeaway: 'A little blanket keeps us alive; too much overheats',
    },
  ],
};
