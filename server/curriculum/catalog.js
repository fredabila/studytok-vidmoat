// Predefined programs: common high-school subjects and university programs with their core
// units, in the order they are usually studied. Anything not matched here is researched
// (server/research.js). Units are written "Title :: one-line summary".

const P = (id, name, levels, topic, aliases, units) => ({
  id, name, levels, topic, aliases,
  units: units.map((u, i) => {
    const [title, summary] = u.split(' :: ');
    return { id: `${id}-u${i + 1}`, title, summary: summary || '', topic };
  }),
});

const HS = ['middle-school', 'high-school'];
const UNI = ['university', 'postgraduate'];

export const CATALOG = [
  // ---------------------------------------------------------------- high school subjects
  P('hs-math', 'Mathematics', HS, 'math', ['math', 'maths', 'mathematics', 'core mathematics', 'elective mathematics', 'further maths', 'additional mathematics', 'algebra', 'pre-calculus'], [
    'Indices, Surds & Logarithms :: rules for powers and roots and how logs undo exponents',
    'Linear & Quadratic Equations :: solving, factorising, completing the square and the formula',
    'Functions & Graphs :: domain, range, transformations and reading graphs',
    'Sequences & Series :: arithmetic and geometric progressions and their sums',
    'Geometry & Mensuration :: angles, circle theorems, areas and volumes',
    'Trigonometry :: SOH-CAH-TOA, sine and cosine rules, bearings',
    'Statistics :: averages, spread, charts and interpreting data',
    'Probability :: outcomes, tree diagrams and combined events',
    'Vectors & Matrices :: magnitude, direction and matrix operations',
    'Introduction to Calculus :: gradients, differentiation and simple integration',
  ]),
  P('hs-biology', 'Biology', HS, 'biology', ['biology', 'bio', 'life science', 'life sciences'], [
    'Cell Biology :: cell structure, organelles and microscopy',
    'Biomolecules & Enzymes :: carbohydrates, proteins, lipids and how enzymes work',
    'Nutrition & Digestion :: diets, the digestive system and absorption',
    'Transport in Plants & Animals :: blood, the heart, xylem and phloem',
    'Respiration & Gas Exchange :: aerobic and anaerobic respiration, lungs and gills',
    'Reproduction :: sexual and asexual reproduction in plants and animals',
    'Genetics & Inheritance :: DNA, genes, Punnett squares and variation',
    'Evolution & Classification :: natural selection and how living things are grouped',
    'Ecology :: food webs, cycles and populations',
    'Human Health & Disease :: pathogens, immunity and non-communicable disease',
  ]),
  P('hs-chemistry', 'Chemistry', HS, 'chemistry', ['chemistry', 'chem'], [
    'Atomic Structure :: protons, neutrons, electrons and isotopes',
    'The Periodic Table :: groups, periods and trends',
    'Chemical Bonding :: ionic, covalent and metallic bonds',
    'The Mole & Stoichiometry :: amounts of substance and reacting masses',
    'States of Matter & Gas Laws :: particle model, Boyle and Charles',
    'Acids, Bases & Salts :: pH, neutralisation and titration',
    'Redox & Electrochemistry :: oxidation states, cells and electrolysis',
    'Rates & Equilibrium :: collision theory, catalysts and Le Chatelier',
    'Organic Chemistry :: hydrocarbons, functional groups and polymers',
    'Energy Changes :: exothermic, endothermic and bond energies',
  ]),
  P('hs-physics', 'Physics', HS, 'physics', ['physics', 'phy'], [
    'Measurement & Units :: SI units, precision and errors',
    'Motion & Kinematics :: speed, velocity, acceleration and graphs',
    "Forces & Newton's Laws :: resultant force, inertia, momentum",
    'Work, Energy & Power :: energy stores, conservation and efficiency',
    'Waves & Sound :: wave properties, reflection and resonance',
    'Light & Optics :: reflection, refraction, lenses',
    'Electricity & Circuits :: current, voltage, resistance and power',
    'Magnetism & Electromagnetism :: fields, motors and induction',
    'Heat & Thermodynamics :: temperature, specific heat and gas behaviour',
    'Atomic & Nuclear Physics :: radioactivity, half-life and fission',
  ]),
  P('hs-economics', 'Economics', HS, 'economics', ['economics', 'econ'], [
    'Scarcity, Choice & Opportunity Cost :: the basic economic problem',
    'Demand & Supply :: how markets set prices',
    'Elasticity :: how strongly buyers and sellers respond',
    'Production & Costs :: factors of production and cost curves',
    'Market Structures :: competition, monopoly and oligopoly',
    'Money & Banking :: functions of money, central banks',
    'National Income :: GDP and how it is measured',
    'Inflation & Unemployment :: causes, effects and policy',
    'International Trade :: comparative advantage and exchange rates',
    'Public Finance :: taxes, government spending and budgets',
  ]),
  P('hs-cs', 'Computer Science / ICT', HS, 'computer-science', ['computer science', 'ict', 'computing', 'information technology', 'computer studies'], [
    'Computer Systems :: hardware, software and the CPU',
    'Number Systems & Data :: binary, hexadecimal and data representation',
    'Algorithms & Flowcharts :: designing step-by-step solutions',
    'Programming Basics :: variables, selection and iteration',
    'Data Structures :: arrays, lists and records',
    'Networks & the Internet :: protocols, IP addresses and the web',
    'Databases :: tables, keys and queries',
    'Cybersecurity :: threats, encryption and safe practice',
    'Computing, Ethics & Society :: privacy, AI and digital impact',
  ]),
  P('hs-history', 'History', HS, 'history', ['history', 'world history'], [
    'Ancient Civilisations :: Egypt, Mesopotamia, Greece and Rome',
    'Empires & Trade Routes :: the Silk Road, trans-Saharan trade and Mali',
    'The Atlantic Slave Trade :: causes, scale and legacy',
    'Colonialism :: the Scramble for Africa and colonial rule',
    'Independence Movements :: decolonisation across Africa and Asia',
    'World War I :: causes, the fronts and the peace',
    'World War II :: causes, key events and consequences',
    'The Cold War :: superpowers, proxy wars and its end',
  ]),
  P('hs-geography', 'Geography', HS, 'earth', ['geography', 'geo'], [
    'Map Reading :: scale, grid references and contours',
    'Plate Tectonics :: earthquakes, volcanoes and plate boundaries',
    'Weather & Climate :: climate zones and weather systems',
    'Rivers & Coasts :: erosion, transport and landforms',
    'Population :: growth, structure and migration',
    'Settlement & Urbanisation :: why cities grow',
    'Agriculture & Resources :: farming systems and resource use',
    'Environmental Change :: deforestation, desertification and climate change',
  ]),

  // ---------------------------------------------------------------- university programs
  P('uni-cs', 'Computer Science', UNI, 'computer-science', ['computer science', 'cs', 'software engineering', 'computer engineering', 'information technology', 'computing'], [
    'Programming Fundamentals :: types, control flow, functions and debugging',
    'Discrete Mathematics :: logic, sets, proofs and graphs',
    'Data Structures :: arrays, linked lists, trees, hash tables',
    'Algorithms & Complexity :: sorting, searching, Big-O and recursion',
    'Computer Architecture :: CPUs, memory hierarchy and instruction sets',
    'Operating Systems :: processes, threads, scheduling and memory',
    'Databases :: relational model, SQL and normalisation',
    'Computer Networks :: TCP/IP, routing and the web stack',
    'Software Engineering :: design, testing and version control',
    'Theory of Computation :: automata, grammars and computability',
    'Machine Learning Basics :: regression, classification and evaluation',
    'Computer Security :: cryptography, authentication and common attacks',
  ]),
  P('uni-medicine', 'Medicine', UNI, 'health', ['medicine', 'mbchb', 'mbbs', 'medical school', 'md', 'medical sciences', 'health sciences'], [
    'Anatomy :: body regions, organs and their relations',
    'Physiology :: how organ systems maintain homeostasis',
    'Biochemistry :: metabolism, enzymes and molecular biology',
    'Histology & Cell Biology :: tissues and cells under the microscope',
    'Microbiology & Immunology :: pathogens and the immune response',
    'Pathology :: mechanisms of disease',
    'Pharmacology :: how drugs act and are handled by the body',
    'Clinical Skills :: history taking and physical examination',
  ]),
  P('uni-nursing', 'Nursing', UNI, 'health', ['nursing', 'bsn', 'midwifery'], [
    'Anatomy & Physiology for Nurses :: structure and function of body systems',
    'Fundamentals of Nursing :: vital signs, hygiene and safe care',
    'Pharmacology for Nurses :: drug classes, dosage and administration',
    'Medical-Surgical Nursing :: caring for adults with common conditions',
    'Maternal & Child Health :: pregnancy, birth and paediatric care',
    'Mental Health Nursing :: assessment and therapeutic communication',
    'Community & Public Health :: prevention, epidemiology and outreach',
    'Infection Prevention & Control :: asepsis and standard precautions',
  ]),
  P('uni-engineering', 'Engineering (Core)', UNI, 'physics', ['engineering', 'mechanical engineering', 'civil engineering', 'chemical engineering', 'general engineering'], [
    'Engineering Mathematics :: calculus, ODEs and linear algebra for engineers',
    'Statics :: equilibrium, free-body diagrams and trusses',
    'Dynamics :: kinematics and kinetics of particles and rigid bodies',
    'Mechanics of Materials :: stress, strain and bending',
    'Thermodynamics :: energy, entropy and power cycles',
    'Fluid Mechanics :: pressure, flow and Bernoulli',
    'Circuit Analysis :: Kirchhoff laws and AC basics',
    'Materials Science :: structure and properties of materials',
  ]),
  P('uni-electrical', 'Electrical & Electronic Engineering', UNI, 'physics', ['electrical engineering', 'electronic engineering', 'eee', 'electrical and electronic engineering', 'telecommunications'], [
    'Circuit Theory :: nodal, mesh analysis and theorems',
    'Analog Electronics :: diodes, transistors and amplifiers',
    'Digital Logic :: gates, flip-flops and state machines',
    'Signals & Systems :: Fourier, Laplace and convolution',
    'Electromagnetics :: fields, waves and transmission lines',
    'Control Systems :: feedback, stability and PID',
    'Power Systems :: generation, transmission and machines',
    'Communication Systems :: modulation and noise',
  ]),
  P('uni-economics', 'Economics', UNI, 'economics', ['economics', 'econ', 'economics and finance'], [
    'Microeconomic Theory :: consumer and producer choice, markets',
    'Macroeconomic Theory :: growth, cycles and policy models',
    'Econometrics :: regression, inference and causality',
    'Development Economics :: poverty, institutions and growth',
    'Money & Banking :: monetary policy and financial systems',
    'Public Economics :: taxation, public goods and welfare',
    'International Economics :: trade theory and exchange rates',
    'Game Theory :: strategic interaction and equilibrium',
  ]),
  P('uni-business', 'Business Administration', UNI, 'business', ['business', 'business administration', 'bba', 'management', 'accounting', 'finance', 'marketing'], [
    'Principles of Management :: planning, organising, leading, controlling',
    'Financial Accounting :: statements, double entry and ratios',
    'Marketing :: segmentation, the marketing mix and branding',
    'Organisational Behaviour :: motivation, teams and culture',
    'Corporate Finance :: time value of money, capital budgeting',
    'Operations Management :: processes, quality and supply chains',
    'Business Law :: contracts, companies and liability',
    'Strategy & Entrepreneurship :: competitive advantage and starting ventures',
  ]),
  P('uni-law', 'Law', UNI, 'law', ['law', 'llb', 'legal studies'], [
    'Legal Systems & Method :: sources of law, courts and precedent',
    'Constitutional Law :: separation of powers and judicial review',
    'Contract Law :: offer, acceptance, consideration and breach',
    'Law of Torts :: negligence, duty of care and damages',
    'Criminal Law :: actus reus, mens rea and defences',
    'Land / Property Law :: ownership, interests and registration',
    'Equity & Trusts :: equitable remedies and trusts',
    'Administrative Law :: controlling public power',
    'Human Rights Law :: rights, limits and enforcement',
  ]),
  P('uni-psychology', 'Psychology', UNI, 'psychology', ['psychology', 'psych'], [
    'Introduction to Psychology :: perspectives and history',
    'Research Methods & Statistics :: designs, bias and significance',
    'Biological Psychology :: neurons, the brain and behaviour',
    'Cognitive Psychology :: memory, attention and decision making',
    'Developmental Psychology :: change across the lifespan',
    'Social Psychology :: attitudes, conformity and groups',
    'Personality & Individual Differences :: traits and measurement',
    'Clinical Psychology :: disorders, diagnosis and therapies',
  ]),
  P('uni-biology', 'Biological Sciences', UNI, 'biology', ['biology', 'biological sciences', 'biochemistry', 'microbiology', 'life sciences', 'biotechnology'], [
    'Cell & Molecular Biology :: membranes, signalling and gene expression',
    'Genetics :: Mendelian and molecular genetics',
    'Biochemistry :: proteins, enzymes kinetics and metabolism',
    'Microbiology :: bacteria, viruses and microbial growth',
    'Physiology :: organ systems and homeostasis',
    'Ecology :: populations, communities and ecosystems',
    'Evolution :: selection, drift and speciation',
    'Biostatistics :: experimental design and analysis',
  ]),
  P('uni-math', 'Mathematics', UNI, 'math', ['mathematics', 'maths', 'math', 'applied mathematics', 'statistics', 'actuarial science'], [
    'Calculus :: limits, derivatives, integrals and series',
    'Linear Algebra :: vectors, matrices, eigenvalues',
    'Differential Equations :: first and second order ODEs',
    'Real Analysis :: rigorous limits and continuity',
    'Abstract Algebra :: groups, rings and fields',
    'Probability :: random variables and distributions',
    'Statistical Inference :: estimation and hypothesis tests',
    'Numerical Methods :: approximation and error',
  ]),
];

const STOP = /\b(bsc|ba|bs|ma|msc|beng|bachelor|bachelors|master|masters|of|in|degree|hons|honours|honors|program|programme|course|the|and|&|studies|dept|department)\b/g;
export const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

/** Best catalog program for a free-text program/subject at a level, or null. */
export function matchProgram(text, levelId) {
  const q = normalize(text);
  if (!q) return null;
  const qTokens = new Set(q.split(' '));
  const lvl = levelId === 'professional' || levelId === 'lifelong' ? 'university' : levelId;
  let best = null;
  for (const p of CATALOG) {
    if (!p.levels.includes(lvl)) continue;
    for (const alias of [p.name, ...p.aliases]) {
      const a = normalize(alias);
      const aTokens = a.split(' ');
      // exact > every alias word appears in the query > the query is part of a longer alias
      const score = q === a ? 3 + aTokens.length : aTokens.every((t) => qTokens.has(t)) ? 2 + aTokens.length : a.includes(q) && q.length > 3 ? 1 : 0;
      if (score && (!best || score > best.score)) best = { program: p, score };
    }
  }
  return best?.program || null;
}

/** Names offered as suggestions in the onboarding form for a level. */
export const catalogNames = (levelId) =>
  CATALOG.filter((p) => p.levels.includes(levelId)).map((p) => ({ id: p.id, name: p.name }));
