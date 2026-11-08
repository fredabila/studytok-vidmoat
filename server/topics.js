// The interest catalog. Each topic carries its own look so the feed is easy to scan:
// a background colour, an accent for key words, and fallback stock queries.

export const TOPICS = [
  { id: 'biology', label: 'Biology', emoji: '🧬', bg: '#07140f', accent: '#34d399', fallbackVisual: 'cells microscope' },
  { id: 'physics', label: 'Physics', emoji: '⚛️', bg: '#0a0f1f', accent: '#60a5fa', fallbackVisual: 'light particles' },
  { id: 'space', label: 'Space', emoji: '🪐', bg: '#05080f', accent: '#8fc1ff', fallbackVisual: 'galaxy stars' },
  { id: 'history', label: 'History', emoji: '🏛️', bg: '#160f07', accent: '#fbbf24', fallbackVisual: 'ancient ruins' },
  { id: 'math', label: 'Math', emoji: '➗', bg: '#0f0a18', accent: '#f472b6', fallbackVisual: 'geometry pattern' },
  { id: 'chemistry', label: 'Chemistry', emoji: '⚗️', bg: '#0b1414', accent: '#2dd4bf', fallbackVisual: 'chemistry lab' },
  { id: 'psychology', label: 'Psychology', emoji: '🧠', bg: '#150a12', accent: '#fb7185', fallbackVisual: 'thinking person' },
  { id: 'economics', label: 'Economics', emoji: '📈', bg: '#0a120a', accent: '#a3e635', fallbackVisual: 'city market' },
  { id: 'computer-science', label: 'Computer Science', emoji: '💻', bg: '#070d14', accent: '#38bdf8', fallbackVisual: 'computer code' },
  { id: 'earth', label: 'Earth & Climate', emoji: '🌍', bg: '#06110f', accent: '#4ade80', fallbackVisual: 'earth landscape' },
  { id: 'health', label: 'Health & Medicine', emoji: '🩺', bg: '#140709', accent: '#f87171', fallbackVisual: 'hospital doctor' },
  { id: 'law', label: 'Law & Government', emoji: '⚖️', bg: '#0e0c07', accent: '#facc15', fallbackVisual: 'courthouse' },
  { id: 'business', label: 'Business', emoji: '💼', bg: '#08101a', accent: '#93c5fd', fallbackVisual: 'office team meeting' },
  { id: 'language', label: 'Language & Literature', emoji: '📖', bg: '#14100a', accent: '#f5b971', fallbackVisual: 'old books library' },
];

// Topics offered as "interests" in onboarding (the extra style topics above are used by courses).
export const INTEREST_TOPICS = TOPICS.slice(0, 10);

export const TOPIC_BY_ID = Object.fromEntries(TOPICS.map((t) => [t.id, t]));

export const topic = (id) => TOPIC_BY_ID[id] || TOPICS[0];
