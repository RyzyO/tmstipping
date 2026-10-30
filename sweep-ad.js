// Melbourne Cup sweep promo shown on page open (once per browser session).
(function () {
  var SESSION_KEY = 'sweepAdSeen';
  var EXPIRES = Date.UTC(2026, 10, 3, 4, 0); // Cup day 3pm AEDT
  if (Date.now() > EXPIRES) return;
  try { if (sessionStorage.getItem(SESSION_KEY)) return; } catch (e) {}

  // Private: only users with sweep access see the promo.
  import('./sweep-access.js').then(function (m) { return m.hasSweepAccess(); }).then(function (ok) { if (ok) start(); });

  function start() {

  var font = document.createElement('link');
  font.rel = 'stylesheet';
  font.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Geist:wght@400;500;600&display=swap';
  document.head.appendChild(font);

  var grain = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E\")";

  var css = document.createElement('style');
  css.textContent =
    '#sweep-ad{position:fixed;inset:0;z-index:10002;background:rgba(14,11,8,.78);display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .3s}' +
    '#sweep-ad.show{opacity:1}' +
    '#sweep-ad .sa-card{position:relative;width:100%;max-width:400px;max-height:94vh;overflow:hidden;border-radius:6px 22px 6px 6px;background:#15110c;color:#f4ede0;font-family:Geist,system-ui,sans-serif;box-shadow:0 28px 70px -12px rgba(60,35,5,.7);transform:translateY(14px) scale(.98);transition:transform .45s cubic-bezier(.2,.9,.3,1.1)}' +
    '#sweep-ad.show .sa-card{transform:none}' +
    '#sweep-ad .sa-photo{height:min(250px,34vh);background:url(images/flemington.jpg) 66% 40%/cover no-repeat}' +
    '#sweep-ad .sa-body{position:relative;margin-top:-34px;padding:26px 24px 20px;background:#15110c;border-radius:22px 0 0 0}' +
    '#sweep-ad .sa-body::after{content:"";position:absolute;inset:0;background:' + grain + ';opacity:.07;pointer-events:none;mix-blend-mode:screen}' +
    '#sweep-ad .sa-meta{font-size:12px;font-weight:500;letter-spacing:.06em;color:#c9a64e;margin-bottom:10px}' +
    '#sweep-ad h2{font-family:Fraunces,Georgia,serif;font-weight:700;font-size:clamp(28px,8vw,34px);line-height:1.04;letter-spacing:-.02em;margin:0;text-wrap:balance}' +
    '#sweep-ad p{margin:12px 0 20px;font-size:15px;line-height:1.5;color:#cfc6b6;max-width:30ch;text-wrap:pretty}' +
    '#sweep-ad .sa-row{display:flex;align-items:center;gap:18px}' +
    '#sweep-ad .sa-cta{position:relative;background:#d4ae55;color:#1a1308;font-weight:600;font-size:15px;padding:13px 22px;border-radius:8px;text-decoration:none;box-shadow:0 10px 24px -8px rgba(212,174,85,.45);transition:transform .2s,background .2s}' +
    '#sweep-ad .sa-cta:hover{background:#e0bc66;transform:translateY(-1px)}' +
    '#sweep-ad .sa-cta:active{transform:scale(.98)}' +
    '#sweep-ad .sa-later{background:none;border:0;padding:6px 0;color:#9b917f;font:inherit;font-size:13px;cursor:pointer;transition:color .2s}' +
    '#sweep-ad .sa-later:hover{color:#f4ede0}' +
    '#sweep-ad .sa-x{position:absolute;top:10px;right:10px;z-index:2;width:32px;height:32px;border-radius:8px;border:0;background:rgba(21,17,12,.7);color:#f4ede0;font-size:20px;line-height:1;cursor:pointer}' +
    '#sweep-ad a:focus-visible,#sweep-ad button:focus-visible{outline:2px solid #d4ae55;outline-offset:3px}';
  document.head.appendChild(css);

  var el = document.createElement('div');
  el.id = 'sweep-ad';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Melbourne Cup sweep');
  el.innerHTML =
    '<div class="sa-card">' +
      '<button class="sa-x" aria-label="Close">&times;</button>' +
      '<div class="sa-photo" role="img" aria-label="Runners racing past the grandstand at Flemington"></div>' +
      '<div class="sa-body">' +
        '<div class="sa-meta">Flemington &middot; Tuesday 3 November</div>' +
        '<h2>Melbourne Cup Sweep 2026</h2>' +
        '<p>Join The Mock Sports sweep to be in with a chance of winning big!</p>' +
        '<div class="sa-row">' +
          '<a class="sa-cta" href="sweep.html">Join the sweep</a>' +
          '<button class="sa-later">Not now</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  function close() {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 300);
  }
  el.querySelector('.sa-x').addEventListener('click', close);
  el.querySelector('.sa-later').addEventListener('click', close);
  el.addEventListener('click', function (e) { if (e.target === el) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && el.isConnected) close(); });

  function show() {
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
  }
  if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }
})();
