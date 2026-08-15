
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
})();
