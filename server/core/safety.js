// What each student may do, by age. One place decides; the API enforces it on every route that
// matters and the app reads the same answer (GET /api/me → user.can) to hide what does not apply.
//
// Under 18 (set up by a parent or guardian, see feed/index.js saveProfile):
//   - no comments: neither reading nor writing them, so no stranger can reach a minor through them;
//     "Ask about this lesson" is the private way to raise a question instead;
//   - no uploaded course pictures (a photo of themselves would be public);
// Under 13 additionally get the gentler lessons the writer is told about (feed/index.js audienceFor).
// Age unknown (older profiles) is treated as an adult only when the profile is not guardian-managed.

export const ADULT = 18;
export const CHILD = 13;

export function ageOf(user) {
  const a = Number(user?.profile?.age);
  return Number.isFinite(a) && a > 0 ? a : null;
}

export function isMinor(user) {
  const age = ageOf(user);
  if (age != null) return age < ADULT;
  return user?.profile?.managedBy === 'guardian';
}

/** { comments, commentPost, courseAvatar, ask, minor, child } for this user. */
export function capabilitiesOf(user) {
  const minor = isMinor(user);
  const age = ageOf(user);
  return {
    minor,
    child: age != null && age < CHILD,
    comments: !minor,
    commentPost: !minor,
    courseAvatar: !minor,
    ask: true,
  };
}

/** Throws a 403 the API turns into a friendly message when `cap` is not allowed. */
export function requireCap(user, cap) {
  if (capabilitiesOf(user)[cap]) return;
  throw Object.assign(new Error('This feature is for students aged 18 and over.'), { status: 403, code: 'age' });
}
