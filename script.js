
(() => {
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (navToggle && nav) navToggle.addEventListener('click', () => { const open = nav.classList.toggle('open'); navToggle.setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-nav a').forEach(a => { if ((a.getAttribute('href')||'') === path) a.setAttribute('aria-current','page'); });
  const reveal = document.querySelector('.reveal-answer');
  if (reveal) reveal.addEventListener('click', () => { const answers = document.querySelector('.answers'); const hidden = answers.hasAttribute('hidden'); if (hidden) answers.removeAttribute('hidden'); else answers.setAttribute('hidden',''); reveal.setAttribute('aria-expanded', String(hidden)); reveal.textContent = hidden ? 'Hide answers' : 'Reveal answers'; });
  const poll = document.querySelector('#reader-poll');
  if (poll) { const status=poll.querySelector('.poll-status'); const saved=localStorage.getItem('hoot-holler-poll'); if(saved){ const input=poll.querySelector(`input[value="${saved}"]`); if(input) input.checked=true; status.textContent='Your last choice is saved on this browser.'; } poll.addEventListener('submit',e=>{e.preventDefault(); const picked=new FormData(poll).get('poll'); if(!picked){status.textContent='Choose one first.';return;} localStorage.setItem('hoot-holler-poll',picked);status.textContent='Vote saved on this browser. Thanks for weighing in.';}); }
  const form = document.querySelector('#contact-form');
  if (form) form.addEventListener('submit', e => { e.preventDefault(); const data=new FormData(form); const topic=data.get('topic')||'Website contact'; const body=`Name: ${data.get('name')}\nEmail: ${data.get('email')}\nTopic: ${topic}\n\n${data.get('message')}`; location.href=`mailto:contact@thehootandhollerpress.com?subject=${encodeURIComponent('Hoot & Holler: '+topic)}&body=${encodeURIComponent(body)}`; });


  // Public D1 advertisement loader.
  // D1 is the source of truth: slots stay hidden unless a matching row has a valid image_path.
  const ADS_API_URL = 'https://worker-d1-public.thehootandhollerpress.workers.dev/ads';

  const resolveAdImage = value => {
    const path = String(value || '').trim();
    if (!path) return '';
    if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
    // CMS stores repository image paths such as "images/ads/example.webp".
    return new URL('/' + path.replace(/^\/+/, ''), location.origin).href;
  };

  const safeAdHref = value => {
    const href = String(value || '').trim();
    if (!href) return '';
    if (/^(?:javascript|data|vbscript):/i.test(href)) return '';
    return href;
  };

  const ensureAdCaption = (slot, text) => {
    let caption = slot.querySelector('.ad-db-caption');
    const value = String(text || '').trim();
    if (!value) {
      if (caption) caption.remove();
      return;
    }
    if (!caption) {
      caption = document.createElement('span');
      caption.className = 'ad-db-caption';
      slot.appendChild(caption);
    }
    caption.textContent = value;
  };

  const hideAdSlot = slot => {
    if (!slot) return;
    slot.dataset.adLoaded = 'false';
    slot.removeAttribute('data-ad-href');
    ensureAdCaption(slot, '');
  };

  const applyAdRow = (slot, ad) => {
    const img = slot.querySelector('img');
    if (!img || !ad) {
      hideAdSlot(slot);
      return;
    }

    const nextImage = resolveAdImage(ad.image_path);
    if (!nextImage) {
      // A seeded location with no creative assigned is intentionally not displayed.
      hideAdSlot(slot);
      return;
    }

    const href = safeAdHref(ad.href);
    if (href) {
      slot.setAttribute('href', href);
      slot.dataset.adHref = href;
    } else {
      // Keep the element non-navigating if no destination was configured.
      slot.removeAttribute('href');
    }

    ensureAdCaption(slot, ad.caption);

    // A few placements use <picture>. D1 stores one creative, so disable any
    // hard-coded responsive source while the database-managed ad is active.
    const picture = img.closest('picture');
    if (picture) {
      picture.querySelectorAll('source').forEach(source => source.removeAttribute('srcset'));
    }

    slot.dataset.adLoaded = 'loading';

    const onLoad = () => {
      slot.dataset.adLoaded = 'true';
    };
    const onError = () => {
      // Do not restore static placeholders. A broken/missing D1 creative means no ad.
      hideAdSlot(slot);
      img.removeAttribute('src');
    };

    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
    img.setAttribute('src', nextImage);
  };

  const loadAdvertisements = async () => {
    const slots = Array.from(document.querySelectorAll('[data-ad-slot]'));
    if (!slots.length) return;

    // Hide every physical slot first. Only D1 rows with valid creatives can reveal one.
    slots.forEach(hideAdSlot);

    try {
      const response = await fetch(ADS_API_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Ads API returned ${response.status}`);

      const payload = await response.json();
      const rows = Array.isArray(payload) ? payload : (Array.isArray(payload?.results) ? payload.results : []);
      const byLocation = new Map(
        rows
          .filter(ad => ad && String(ad.location || '').trim())
          .map(ad => [String(ad.location).trim(), ad])
      );

      slots.forEach(slot => {
        const locationName = String(slot.dataset.adSlot || '').trim();
        const ad = byLocation.get(locationName);
        if (ad) applyAdRow(slot, ad);
      });
    } catch (error) {
      // Fail closed: if D1/the public Worker is unavailable, no ad is displayed.
      console.warn('Advertisement feed unavailable; ad slots remain hidden.', error);
    }
  };

  loadAdvertisements();
})();
