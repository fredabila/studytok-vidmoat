// Vercel Function: every /api/* request is rewritten here (see vercel.json).
// The static frontend in public/ is served by Vercel's CDN.
import { handleApi } from '../server/app.js';

export default function handler(req, res) {
  return handleApi(req, res);
}
