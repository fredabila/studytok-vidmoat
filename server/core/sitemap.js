// /sitemap.xml: the home page and every ready lesson page (/v/:id), each with its share image,
// so search engines find lessons without having to be sent a link first.

import { escapeHtml } from './watch.js';

/** One sitemap file holds at most 50,000 URLs; the home page takes one. */
export const SITEMAP_LIMIT = 49_000;

const day = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : null);

/** `lessons`: [{ id, at }] newest first, `at` in ms. */
export function sitemapXml(site, lessons) {
  const e = escapeHtml;
  const newest = day(lessons[0]?.at) || new Date().toISOString().slice(0, 10);
  const rows = lessons
    .filter((l) => /^[0-9a-f-]{36}$/.test(String(l.id)))
    .map((l) => {
      const loc = `${site}/v/${l.id}`;
      const mod = day(l.at);
      return `  <url>
    <loc>${e(loc)}</loc>${mod ? `\n    <lastmod>${mod}</lastmod>` : ''}
    <image:image><image:loc>${e(`${site}/og/v/${l.id}.png`)}</image:loc></image:image>
  </url>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${e(`${site}/`)}</loc>
    <lastmod>${newest}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${rows.join('\n')}
</urlset>
`;
}
