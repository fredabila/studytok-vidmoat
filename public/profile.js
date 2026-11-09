// Public course profile page (/@handle, server/core/profile.js): the Share button.
const btn = document.querySelector('.p-share');
const handle = document.querySelector('.profile')?.dataset.handle;
const beacon = (type, extra = {}) => {
  // Anonymous count of profile shares from the public page (POST /api/funnel ignores unknown steps).
  try { navigator.sendBeacon?.('/api/funnel', new Blob([JSON.stringify({ step: type, handle, ...extra })], { type: 'text/plain' })); } catch { /* fine */ }
};
btn?.addEventListener('click', async () => {
  const url = btn.dataset.url;
  const title = btn.dataset.title;
  try {
    if (navigator.share) { await navigator.share({ title, text: `${title} on StudyGraph`, url }); beacon('profile_share', { by: 'native' }); return; }
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied';
    beacon('profile_share', { by: 'copy' });
    setTimeout(() => { btn.textContent = 'Share'; }, 2000);
  } catch { /* cancelled */ }
});
