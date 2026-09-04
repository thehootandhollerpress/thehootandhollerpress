
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
    const raw = String(value || '').trim();
    if (!raw) return 'Date TBA';
    const d = new Date(raw + 'T12:00:00');
    return Number.isNaN(d.getTime())
      ? raw
      : d.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  };

  const eventDateRangeLabel = ev => {
    const start = String(ev.event_date || '').trim();
    const end = String(ev.end_date || '').trim();
    if (!start) return 'Date TBA';
    if (end && end !== start) return `${eventDateLabel(start)} – ${eventDateLabel(end)}`;
    return eventDateLabel(start);
  };

  const eventTimeRangeLabel = ev => {
    const start = String(ev.event_time || '').trim();
    const end = String(ev.end_time || '').trim();
    if (start && end && !/[-–—]/.test(start)) return `${start} – ${end}`;
    return start || (end ? `Until ${end}` : '');
  };

  const eventMeta = ev => [
    eventDateRangeLabel(ev),
    eventTimeRangeLabel(ev),
    String(ev.location || '').trim()
  ].filter(Boolean).join(' • ');

  const safePublicUrl = value => {
    const u = String(value || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  };

  const internalEventUrl = ev => `event.html?id=${encodeURIComponent(String(ev.id || ''))}`;

  const renderHomeEvents = events => {
    const host = document.querySelector('[data-events-home]');
    if (!host) return;
    host.innerHTML = '';

    const rows = events.slice(0, 3);
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'events-empty-public';
      p.textContent = 'No published events yet.';
      host.appendChild(p);
      return;
    }

    rows.forEach(ev => {
      const item = document.createElement('div');
      item.className = 'home-event-item';

      const title = document.createElement('strong');
      const titleLink = document.createElement('a');
      titleLink.href = internalEventUrl(ev);
      titleLink.textContent = ev.title || 'Untitled event';
      title.appendChild(titleLink);

      const meta = document.createElement('div');
      meta.className = 'event-meta';
      meta.textContent = eventMeta(ev);

      item.append(title, meta);
      host.appendChild(item);
    });
  };

  const renderCommunityEvents = events => {
    const host = document.querySelector('[data-events-list]');
    if (!host) return;
    host.innerHTML = '';

    if (!events.length) {
      const p = document.createElement('p');
      p.className = 'events-empty-public';
      p.textContent = 'No published events yet.';
      host.appendChild(p);
      return;
    }

    events.slice(0, 24).forEach(ev => {
      const card = document.createElement('article');
      card.className = 'community-event-card';

      const meta = document.createElement('div');
      meta.className = 'event-meta';
      meta.textContent = eventMeta(ev);

      const h = document.createElement('h3');
      const titleLink = document.createElement('a');
      titleLink.href = internalEventUrl(ev);
      titleLink.textContent = ev.title || 'Untitled event';
      h.appendChild(titleLink);

      card.append(meta, h);

      if (ev.description) {
        const p = document.createElement('p');
        p.textContent = ev.description;
        card.appendChild(p);
      }

      const detailLink = document.createElement('a');
      detailLink.className = 'event-internal-link';
      detailLink.href = internalEventUrl(ev);
      detailLink.textContent = 'View event →';
      card.appendChild(detailLink);

      host.appendChild(card);
    });
  };

  const renderEventDetail = ev => {
    const host = document.querySelector('[data-event-detail]');
    if (!host) return;
    host.innerHTML = '';

    if (!ev) {
      const empty = document.createElement('div');
      empty.className = 'event-detail-empty';
      const h = document.createElement('h1');
      h.textContent = 'Event not found';
      const p = document.createElement('p');
      p.textContent = 'This event may have expired or is no longer published.';
      const back = document.createElement('a');
      back.className = 'btn solid';
      back.href = 'community.html#upcoming-events';
      back.textContent = 'Back to upcoming events';
      empty.append(h, p, back);
      host.appendChild(empty);
      return;
    }

    document.title = `${ev.title || 'Event'} | The Hoot & Holler Press`;

    const article = document.createElement('article');
    article.className = 'event-detail-card';

    const back = document.createElement('a');
    back.className = 'event-detail-back';
    back.href = 'community.html#upcoming-events';
    back.textContent = '← Back to upcoming events';

    const meta = document.createElement('div');
    meta.className = 'event-meta event-detail-meta';
    meta.textContent = eventMeta(ev);

    const h = document.createElement('h1');
    h.textContent = ev.title || 'Untitled event';

    const body = document.createElement('div');
    body.className = 'event-detail-body';

    const imageUrl = safePublicUrl(ev.image_url);
    if (Number(ev.show_image || 0) === 1 && imageUrl) {
      const media = document.createElement('figure');
      media.className = 'event-detail-media';
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = ev.title ? `${ev.title} event image` : 'Event image';
      img.loading = 'eager';
      img.addEventListener('error', () => media.remove());
      media.appendChild(img);
      body.appendChild(media);
    }

    const copy = document.createElement('div');
    copy.className = 'event-detail-copy';

    if (ev.description) {
      String(ev.description).split(/\n{2,}/).filter(Boolean).forEach(part => {
        const p = document.createElement('p');
        p.textContent = part.trim();
        copy.appendChild(p);
      });
    } else {
      const p = document.createElement('p');
      p.textContent = 'No additional description was provided.';
      copy.appendChild(p);
    }

    const sourceUrl = safePublicUrl(ev.source_url);
    if (sourceUrl) {
      const sourceWrap = document.createElement('div');
      sourceWrap.className = 'event-source-cta';

      const sourceLabel = document.createElement('span');
      sourceLabel.className = 'small-cap';
      sourceLabel.textContent = ev.source_name || 'Original source';

      const sourceLink = document.createElement('a');
      sourceLink.className = 'btn solid';
      sourceLink.href = sourceUrl;
      sourceLink.target = '_blank';
      sourceLink.rel = 'noopener noreferrer';
      sourceLink.textContent = ev.source_name
        ? `View on ${ev.source_name} →`
        : 'View original event listing →';

      sourceWrap.append(sourceLabel, sourceLink);
      copy.appendChild(sourceWrap);
    }

    body.appendChild(copy);
    article.append(back, meta, h, body);
    host.appendChild(article);
  };

  const loadPublishedEvents = async () => {
    if (!document.querySelector('[data-events-home],[data-events-list]')) return;
    try {
      const r = await fetch(EVENTS_API_URL, { headers:{ Accept:'application/json' }, cache:'no-store' });
      if (!r.ok) throw new Error(`Events API returned ${r.status}`);
      const data = await r.json();
      const rows = Array.isArray(data) ? data : [];
      renderHomeEvents(rows);
      renderCommunityEvents(rows);
    } catch (err) {
      console.warn('Events feed unavailable.', err);
      renderHomeEvents([]);
      renderCommunityEvents([]);
    }
  };

  const loadEventDetail = async () => {
    const host = document.querySelector('[data-event-detail]');
    if (!host) return;

    const id = new URLSearchParams(window.location.search).get('id');
    if (!id || !/^\d+$/.test(id)) {
      renderEventDetail(null);
      return;
    }

    try {
      const r = await fetch(`${EVENTS_API_URL}/${encodeURIComponent(id)}`, {
        headers:{ Accept:'application/json' },
        cache:'no-store'
      });
      if (!r.ok) {
        renderEventDetail(null);
        return;
      }
      renderEventDetail(await r.json());
    } catch (err) {
      console.warn('Event detail unavailable.', err);
      renderEventDetail(null);
    }
  };



  // Published weekly Hoot + Trivia loader.
  const WEEKLY_CONTENT_API_URL = 'https://worker-d1-public.thehootandhollerpress.workers.dev/weekly-content';

  const setWeeklyRevealState = (section, enabled) => {
    if (!section) return;
    const button = section.querySelector('.reveal-answer');
    const answers = section.querySelector('.answers');
    if (button) {
      button.disabled = !enabled;
      button.setAttribute('aria-expanded', 'false');
      button.textContent = button.dataset.revealShow || button.textContent;
    }
    if (answers) answers.setAttribute('hidden', '');
  };

  const renderWeeklyContent = payload => {
    const hoot = payload && payload.hoot;
    const trivia = payload && payload.trivia;

    const hootSection = document.querySelector('[data-weekly-hoot]');
    if (hootSection) {
      const setup = hootSection.querySelector('[data-weekly-hoot-setup]');
      const punchline = hootSection.querySelector('[data-weekly-hoot-punchline]');

      if (hoot) {
        if (setup) setup.textContent = hoot.setup || '';
        if (punchline) punchline.textContent = hoot.punchline || '';
        setWeeklyRevealState(hootSection, true);
      } else {
        if (setup) setup.textContent = 'Hoot of the Week will appear here once published.';
        if (punchline) punchline.textContent = '';
        setWeeklyRevealState(hootSection, false);
      }
    }

    const triviaSection = document.querySelector('[data-weekly-trivia]');
    if (triviaSection) {
      const question = triviaSection.querySelector('[data-weekly-trivia-question]');
      const answer = triviaSection.querySelector('[data-weekly-trivia-answer]');

      if (trivia) {
        if (question) question.textContent = trivia.question || '';
        if (answer) answer.textContent = trivia.answer || '';
        setWeeklyRevealState(triviaSection, true);
      } else {
        if (question) question.textContent = 'Trivia will appear here once published.';
        if (answer) answer.textContent = '';
        setWeeklyRevealState(triviaSection, false);
      }
    }
  };

  const loadWeeklyContent = async () => {
    if (!document.querySelector('[data-weekly-hoot],[data-weekly-trivia]')) return;

    try {
      const r = await fetch(WEEKLY_CONTENT_API_URL, {
        headers:{Accept:'application/json'},
        cache:'no-store'
      });

      if (!r.ok) throw new Error(`Weekly content API returned ${r.status}`);
      renderWeeklyContent(await r.json());
    } catch (err) {
      console.warn('Weekly content feed unavailable.', err);
      renderWeeklyContent({hoot:null,trivia:null});
    }
  };

  // Automatic weekly Sudoku + word-search loader.
  const WEEKLY_PUZZLES_URL = 'puzzles/current.json';

  const puzzleDateLabel = isoDate => {
    try {
      const d = new Date(`${isoDate}T12:00:00`);
      return new Intl.DateTimeFormat('en-US', {month:'long', day:'numeric', year:'numeric'}).format(d);
    } catch (_) {
      return isoDate || '';
    }
  };

  const clearPuzzleCheckClasses = host => {
    if (!host) return;
    host.querySelectorAll('input').forEach(input => input.classList.remove('is-wrong','is-right'));
  };

  const renderSudoku = sudoku => {
    const host = document.querySelector('[data-sudoku-grid]');
    if (!host || !sudoku || !Array.isArray(sudoku.puzzle) || !Array.isArray(sudoku.solution)) return;
    host.innerHTML = '';
    sudoku.puzzle.forEach((row, r) => row.forEach((value, c) => {
      const input = document.createElement('input');
      input.className = 'sudoku-cell';
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.maxLength = 1;
      input.setAttribute('aria-label', `Sudoku row ${r + 1}, column ${c + 1}`);
      input.dataset.solution = String(sudoku.solution[r][c]);
      if (c === 2 || c === 5) input.classList.add('sudoku-box-right');
      if (r === 2 || r === 5) input.classList.add('sudoku-box-bottom');
      if (value) {
        input.value = String(value);
        input.readOnly = true;
        input.classList.add('is-given');
      } else {
        input.addEventListener('input', () => {
          input.value = input.value.replace(/[^1-9]/g, '').slice(0, 1);
          input.classList.remove('is-wrong','is-right');
        });
      }
      host.appendChild(input);
    }));
    const difficulty = document.querySelector('[data-sudoku-difficulty]');
    if (difficulty) difficulty.textContent = `${sudoku.difficulty || 'medium'} • ${sudoku.clues || ''} clues`;
  };

  let wordSearchState = null;

  const wordSearchLine = (start, end) => {
    const dr = Math.sign(end.row - start.row);
    const dc = Math.sign(end.col - start.col);
    const rowDistance = Math.abs(end.row - start.row);
    const colDistance = Math.abs(end.col - start.col);
    if (!(start.row === end.row || start.col === end.col || rowDistance === colDistance)) return [];
    const length = Math.max(rowDistance, colDistance) + 1;
    return Array.from({length}, (_, i) => ({row:start.row + dr * i, col:start.col + dc * i}));
  };

  const wordSearchKey = cells => cells.map(cell => `${cell.row}:${cell.col}`).join('|');

  const setWordSearchStatus = message => {
    const status = document.querySelector('[data-wordsearch-status]');
    if (status) status.textContent = message;
  };

  const paintWordSearch = () => {
    if (!wordSearchState) return;
    const host = document.querySelector('[data-wordsearch-grid]');
    if (!host) return;
    host.querySelectorAll('.wordsearch-cell').forEach(cell => {
      const key = `${cell.dataset.row}:${cell.dataset.col}`;
      cell.classList.toggle('is-found', wordSearchState.foundCells.has(key));
      cell.classList.toggle('is-selected', wordSearchState.start?.row === Number(cell.dataset.row) && wordSearchState.start?.col === Number(cell.dataset.col));
      cell.classList.toggle('is-solution', wordSearchState.solutionCells.has(key));
    });
    document.querySelectorAll('[data-wordsearch-word]').forEach(word => {
      word.classList.toggle('is-found', wordSearchState.foundWords.has(word.dataset.wordsearchWord));
    });
  };

  const chooseWordSearchCell = (row, col) => {
    if (!wordSearchState || wordSearchState.showingSolution) return;
    if (!wordSearchState.start) {
      wordSearchState.start = {row, col};
      setWordSearchStatus('Now click the last letter of the word.');
      paintWordSearch();
      return;
    }

    const cells = wordSearchLine(wordSearchState.start, {row, col});
    wordSearchState.start = null;
    if (!cells.length) {
      setWordSearchStatus('Selections must be horizontal, vertical, or diagonal.');
      paintWordSearch();
      return;
    }

    const forward = wordSearchKey(cells);
    const backward = wordSearchKey([...cells].reverse());
    const match = wordSearchState.placements.find(item => item.key === forward || item.key === backward);
    if (!match) {
      setWordSearchStatus('That line is not one of this week\'s hidden words.');
      paintWordSearch();
      return;
    }

    wordSearchState.foundWords.add(match.word);
    match.cells.forEach(cell => wordSearchState.foundCells.add(`${cell.row}:${cell.col}`));
    const total = wordSearchState.placements.length;
    const found = wordSearchState.foundWords.size;
    setWordSearchStatus(found === total ? 'You found every word!' : `Found ${match.word}. ${total - found} left.`);
    paintWordSearch();
  };

  const renderWordSearch = wordsearch => {
    const host = document.querySelector('[data-wordsearch-grid]');
    const bank = document.querySelector('[data-wordsearch-words]');
    if (!host || !bank || !wordsearch || !Array.isArray(wordsearch.grid) || !Array.isArray(wordsearch.placements)) return;
    host.innerHTML = '';
    bank.innerHTML = '';
    host.style.gridTemplateColumns = `repeat(${wordsearch.cols}, 1fr)`;

    const placements = wordsearch.placements.map(item => {
      const cells = wordSearchLine({row:item.start_row, col:item.start_col}, {row:item.end_row, col:item.end_col});
      return {word:item.word, cells, key:wordSearchKey(cells)};
    });
    wordSearchState = {
      placements,
      foundWords:new Set(),
      foundCells:new Set(),
      solutionCells:new Set(),
      start:null,
      showingSolution:false
    };

    wordsearch.grid.forEach((line, row) => Array.from(line).forEach((letter, col) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wordsearch-cell';
      button.textContent = letter;
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `Word search row ${row + 1}, column ${col + 1}, letter ${letter}`);
      button.addEventListener('click', () => chooseWordSearchCell(row, col));
      host.appendChild(button);
    }));

    (wordsearch.words || []).forEach(word => {
      const item = document.createElement('span');
      item.textContent = word;
      item.dataset.wordsearchWord = word;
      bank.appendChild(item);
    });
    const count = document.querySelector('[data-wordsearch-count]');
    if (count) count.textContent = `${wordsearch.words?.length || 0} words`;
  };

  const clearWordSearch = () => {
    if (!wordSearchState) return;
    wordSearchState.foundWords.clear();
    wordSearchState.foundCells.clear();
    wordSearchState.solutionCells.clear();
    wordSearchState.start = null;
    wordSearchState.showingSolution = false;
    const reveal = document.querySelector('[data-puzzle-action="reveal-wordsearch"]');
    if (reveal) reveal.textContent = 'Show solution';
    setWordSearchStatus('Selection cleared.');
    paintWordSearch();
  };

  const toggleWordSearchSolution = button => {
    if (!wordSearchState || !button) return;
    wordSearchState.showingSolution = !wordSearchState.showingSolution;
    wordSearchState.start = null;
    wordSearchState.solutionCells.clear();
    if (wordSearchState.showingSolution) {
      wordSearchState.placements.forEach(item => item.cells.forEach(cell => wordSearchState.solutionCells.add(`${cell.row}:${cell.col}`)));
      setWordSearchStatus('Solution shown. Hide it to continue solving.');
    } else {
      setWordSearchStatus('Solution hidden.');
    }
    button.textContent = wordSearchState.showingSolution ? 'Hide solution' : 'Show solution';
    paintWordSearch();
  };

  const checkPuzzle = (selector, statusSelector) => {
    const host = document.querySelector(selector);
    const status = document.querySelector(statusSelector);
    if (!host) return;
    let filled = 0;
    let wrong = 0;
    host.querySelectorAll('input:not(.is-given)').forEach(input => {
      input.classList.remove('is-wrong','is-right');
      const value = input.value.trim().toUpperCase();
      if (!value) return;
      filled += 1;
      if (value === String(input.dataset.solution || '').toUpperCase()) input.classList.add('is-right');
      else { input.classList.add('is-wrong'); wrong += 1; }
    });
    if (status) {
      if (!filled) status.textContent = 'Fill in a few squares first.';
      else if (wrong) status.textContent = `${wrong} filled square${wrong === 1 ? '' : 's'} need another look.`;
      else status.textContent = 'Everything filled so far is correct.';
    }
  };

  const togglePuzzleSolution = (selector, button, statusSelector) => {
    const host = document.querySelector(selector);
    const status = document.querySelector(statusSelector);
    if (!host || !button) return;
    const showing = button.dataset.showingSolution === 'true';
    clearPuzzleCheckClasses(host);
    host.querySelectorAll('input:not(.is-given)').forEach(input => {
      if (!showing) {
        input.dataset.userValue = input.value;
        input.value = input.dataset.solution || '';
        input.readOnly = true;
        input.classList.add('is-solution');
      } else {
        input.value = input.dataset.userValue || '';
        input.readOnly = false;
        input.classList.remove('is-solution');
      }
    });
    button.dataset.showingSolution = String(!showing);
    button.textContent = showing ? 'Show solution' : 'Hide solution';
    if (status) status.textContent = showing ? '' : 'Solution shown. Hide it to continue solving.';
  };

  const wirePuzzleActions = () => {
    document.querySelector('[data-puzzle-action="check-sudoku"]')?.addEventListener('click', () => checkPuzzle('[data-sudoku-grid]', '[data-sudoku-status]'));
    document.querySelector('[data-puzzle-action="reveal-sudoku"]')?.addEventListener('click', event => togglePuzzleSolution('[data-sudoku-grid]', event.currentTarget, '[data-sudoku-status]'));
    document.querySelector('[data-puzzle-action="clear-wordsearch"]')?.addEventListener('click', clearWordSearch);
    document.querySelector('[data-puzzle-action="reveal-wordsearch"]')?.addEventListener('click', event => toggleWordSearchSolution(event.currentTarget));
  };

  const loadWeeklyPuzzles = async () => {
    const section = document.querySelector('[data-weekly-puzzles]');
    if (!section) return;
    const error = document.querySelector('[data-puzzle-error]');
    try {
      const response = await fetch(WEEKLY_PUZZLES_URL, {headers:{Accept:'application/json'}, cache:'no-store'});
      if (!response.ok) throw new Error(`Puzzle feed returned ${response.status}`);
      const payload = await response.json();
      renderSudoku(payload.sudoku);
      renderWordSearch(payload.wordsearch);
      const issue = document.querySelector('[data-puzzle-issue]');
      if (issue && payload.issue) issue.textContent = `Week of ${puzzleDateLabel(payload.issue.week_start)} • ${payload.issue.iso_week || ''}`;
      if (error) error.hidden = true;
    } catch (err) {
      console.warn('Weekly puzzle feed unavailable.', err);
      if (error) error.hidden = false;
    }
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
  loadWeeklyContent();
  wirePuzzleActions();
  loadWeeklyPuzzles();
  loadEventDetail();

  loadAdvertisements();
})();
