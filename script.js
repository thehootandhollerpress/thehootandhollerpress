
(() => {
  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');
  if (navToggle && nav) navToggle.addEventListener('click', () => { const open = nav.classList.toggle('open'); navToggle.setAttribute('aria-expanded', String(open)); });
  document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
  const path = location.pathname;
  const currentNavHref = (path === '/' || path.endsWith('/index.html'))
    ? '/'
    : path.split('/').pop();
  document.querySelectorAll('.site-nav a').forEach(a => {
    if ((a.getAttribute('href') || '') === currentNavHref) {
      a.setAttribute('aria-current', 'page');
    }
  });
  document.querySelectorAll('.reveal-answer').forEach(reveal => {
    const section = reveal.closest('section');
    const answers = section ? section.querySelector('.answers') : null;
    if (!answers) return;

    const showLabel = reveal.dataset.revealShow || reveal.textContent.trim() || 'Reveal';
    const hideLabel = reveal.dataset.revealHide || showLabel.replace(/^Reveal/i, 'Hide');

    reveal.addEventListener('click', () => {
      const hidden = answers.hasAttribute('hidden');
      if (hidden) answers.removeAttribute('hidden');
      else answers.setAttribute('hidden', '');
      reveal.setAttribute('aria-expanded', String(hidden));
      reveal.textContent = hidden ? hideLabel : showLabel;
    });
  });
  const form = document.querySelector('#contact-form');
  if (form) {
    const submitButton = form.querySelector('button[type="submit"]');
    const status = form.querySelector('#contact-form-status');

    form.addEventListener('submit', async e => {
      e.preventDefault();

      if (!form.reportValidity()) return;

      const data = new FormData(form);
      const turnstileToken = String(data.get('cf-turnstile-response') || '').trim();

      if (!turnstileToken) {
        if (status) {
          status.dataset.state = 'error';
          status.textContent = 'Please complete the anti-spam verification.';
        }
        return;
      }

      const originalButtonText = submitButton ? submitButton.textContent : 'Send message';

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Sending...';
      }
      if (status) {
        status.dataset.state = 'sending';
        status.textContent = 'Sending your message...';
      }

      try {
        await fetch(form.action, {
          method: 'POST',
          mode: 'no-cors',
          body: data
        });

        form.reset();

        if (window.turnstile && typeof window.turnstile.reset === 'function') {
          window.turnstile.reset();
        }

        if (status) {
          status.dataset.state = 'success';
          status.textContent = 'Thanks — your message has been submitted.';
        }
      } catch (error) {
        console.error('Contact form submission failed:', error);

        if (window.turnstile && typeof window.turnstile.reset === 'function') {
          window.turnstile.reset();
        }

        if (status) {
          status.dataset.state = 'error';
          status.textContent = 'The message could not be submitted. Please try again.';
        }
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalButtonText;
        }
      }
    });
  }

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



  // Published D1 events loader.
  const EVENTS_API_URL = 'https://worker-d1-public.thehootandhollerpress.workers.dev/events';
  const eventDateLabel = value => {
    const raw = String(value || '').trim(); if (!raw) return 'Date TBA';
    const d = new Date(raw + 'T12:00:00');
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  };
  const eventMeta = ev => [eventDateLabel(ev.event_date), String(ev.event_time || '').trim(), String(ev.location || '').trim()].filter(Boolean).join(' • ');
  const safePublicUrl = value => { const u=String(value||'').trim(); return /^https?:\/\//i.test(u) ? u : ''; };
  const renderHomeEvents = events => {
    const host=document.querySelector('[data-events-home]'); if(!host) return; host.innerHTML='';
    const rows=events.slice(0,3); if(!rows.length){ const p=document.createElement('p'); p.className='events-empty-public'; p.textContent='No published events yet.'; host.appendChild(p); return; }
    rows.forEach(ev=>{ const item=document.createElement('div'); item.className='home-event-item'; const title=document.createElement('strong'); title.textContent=ev.title||'Untitled event'; const meta=document.createElement('div'); meta.className='event-meta'; meta.textContent=eventMeta(ev); item.append(title,meta); host.appendChild(item); });
  };
  const renderCommunityEvents = events => {
    const host=document.querySelector('[data-events-list]'); if(!host) return; host.innerHTML='';
    if(!events.length){ const p=document.createElement('p'); p.className='events-empty-public'; p.textContent='No published events yet.'; host.appendChild(p); return; }
    events.slice(0,24).forEach(ev=>{ const card=document.createElement('article'); card.className='community-event-card'; const meta=document.createElement('div'); meta.className='event-meta'; meta.textContent=eventMeta(ev); const h=document.createElement('h3'); h.textContent=ev.title||'Untitled event'; card.append(meta,h); if(ev.description){ const p=document.createElement('p'); p.textContent=ev.description; card.appendChild(p); } const u=safePublicUrl(ev.source_url); if(u){ const a=document.createElement('a'); a.href=u; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Event details →'; card.appendChild(a); } host.appendChild(card); });
  };
  const loadPublishedEvents = async () => {
    if (!document.querySelector('[data-events-home],[data-events-list]')) return;
    try { const r=await fetch(EVENTS_API_URL,{headers:{Accept:'application/json'},cache:'no-store'}); if(!r.ok) throw new Error(`Events API returned ${r.status}`); const data=await r.json(); const rows=Array.isArray(data)?data:[]; renderHomeEvents(rows); renderCommunityEvents(rows); }
    catch(err){ console.warn('Events feed unavailable.',err); renderHomeEvents([]); renderCommunityEvents([]); }
  };


  // Animated footer owl.
  document.querySelectorAll('.footer-owl-stage').forEach(owl => {
    const badge = owl.querySelector('.footer-owl-badge');
    let cleanupTimer = 0;
    let lastTouchTrigger = 0;

    const replayOwl = () => {
      window.clearTimeout(cleanupTimer);

      // Force Firefox/Android to see a fresh animation state on every tap.
      owl.classList.remove('is-bouncing', 'is-hooting');
      if (badge) {
        badge.style.animation = 'none';
        void badge.offsetWidth;
        badge.style.animation = '';
      } else {
        void owl.offsetWidth;
      }

      requestAnimationFrame(() => {
        owl.classList.add('is-bouncing', 'is-hooting');
      });

      cleanupTimer = window.setTimeout(() => {
        owl.classList.remove('is-bouncing', 'is-hooting');
      }, 950);
    };

    // pointerup fires reliably on Firefox Android and avoids sticky :hover behavior.
    owl.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        lastTouchTrigger = Date.now();
        replayOwl();
      }
    });

    // Keep normal mouse clicks and keyboard activation working without double-firing
    // after a touch-generated click.
    owl.addEventListener('click', () => {
      if (Date.now() - lastTouchTrigger > 700) {
        replayOwl();
      }
    });

    if (badge) {
      badge.addEventListener('animationend', event => {
        if (event.animationName === 'footer-owl-bounce') {
          owl.classList.remove('is-bouncing');
        }
      });
    }

    const finePointer = window.matchMedia &&
      window.matchMedia('(hover:hover) and (pointer:fine)').matches;

    if (finePointer) {
      owl.addEventListener('mousemove', event => {
        const rect = owl.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        owl.style.setProperty('--footer-ry', `${(x * 10).toFixed(2)}deg`);
        owl.style.setProperty('--footer-rx', `${(-y * 8).toFixed(2)}deg`);
      });

      owl.addEventListener('mouseleave', () => {
        owl.style.setProperty('--footer-ry', '0deg');
        owl.style.setProperty('--footer-rx', '0deg');
      });
    }
  });

  // Make the standalone round owl on the contact page replay its bounce
  // on every tap, including Firefox Android.
  document.querySelectorAll('.contact-side img[src$="owl-mark.svg"]').forEach(owlImg => {
    let lastTouchTrigger = 0;

    const replayMark = () => {
      owlImg.classList.remove('owl-tap-bounce');
      owlImg.style.animation = 'none';
      void owlImg.offsetWidth;
      owlImg.style.animation = '';
      requestAnimationFrame(() => {
        owlImg.classList.add('owl-tap-bounce');
      });
    };

    owlImg.addEventListener('pointerup', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        lastTouchTrigger = Date.now();
        replayMark();
      }
    });

    owlImg.addEventListener('click', () => {
      if (Date.now() - lastTouchTrigger > 700) {
        replayMark();
      }
    });

    owlImg.addEventListener('animationend', event => {
      if (event.animationName === 'owl-mark-bounce') {
        owlImg.classList.remove('owl-tap-bounce');
      }
    });
  });

  loadPublishedEvents();

  loadAdvertisements();
})();
