// Study levels. `audience` is what lesson and research prompts are told about the viewer.

export const LEVELS = [
  { id: 'middle-school', label: 'Middle / Junior High', emoji: '🎒', audience: 'a middle-school / junior-high student (ages 11-14): concrete examples, no jargon without a definition' },
  { id: 'high-school', label: 'High School / Senior High', emoji: '📚', audience: 'a high-school / senior-high student (ages 14-18) preparing for national exams: exam-relevant definitions, worked examples and common mistakes' },
  { id: 'university', label: 'University / College', emoji: '🎓', audience: 'an undergraduate university student: precise terminology, mechanisms and how ideas connect, at first- and second-year level' },
  { id: 'postgraduate', label: 'Postgraduate', emoji: '🔬', audience: 'a postgraduate student: rigorous, assumes undergraduate foundations, focuses on nuance, methods and current understanding' },
  { id: 'professional', label: 'Professional / Certification', emoji: '💼', audience: 'a working professional studying for a qualification: applied, practical, exam-focused' },
  { id: 'lifelong', label: 'Just curious', emoji: '✨', audience: 'a curious adult learner: intuitive explanations and surprising, accurate facts' },
];

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
export const level = (id) => LEVEL_BY_ID[id] || LEVEL_BY_ID.lifelong;
