/*
 * Resume Gemini, cote YouTube : bouton, prompt, panneau, timecodes cliquables,
 * suivi de la lecture et disparition au changement de video.
 * Le service worker est simule : on verifie ce que la page lui envoie et ce
 * qu'elle fait de sa reponse.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = EXT;
const lire = (f) => fs.readFileSync(DIR + f, 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

const SEGMENTS = [
  [0, 'Salut à tous'], [6, 'aujourd’hui on teste'], [14, 'un nouveau jeu'], [23, 'de construction'],
  [31, 'les règles sont simples'], [44, 'premier niveau'], [58, 'ça se complique'], [72, 'la conclusion']
];
const fmtTs = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

const REPONSE = [
  { type: 'h', text: 'En bref' },
  { type: 'p', text: 'Une vidéo de test sur un jeu de construction.' },
  { type: 'h', text: 'Points clés' },
  { type: 'li', text: '[0:00] Présentation du jeu' },
  { type: 'li', text: '[0:31] Les règles' },
  { type: 'li', text: '[0:58] La difficulté monte' },
  { type: 'li', text: 'Une fausse heure 23:59 qui dépasse la vidéo' },
  { type: 'h', text: 'À retenir' },
  { type: 'p', text: 'Le jeu devient dur vers [1:12].' }
];

function page({ reponse = { ok: true, blocks: REPONSE }, delai = 200 } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const segs = SEGMENTS.map(([s, t]) => `<div><div><span>${fmtTs(s)}</span></div><div>${t}</div></div>`).join('');

  const dom = new JSDOM(`<!doctype html><html lang="fr"><body>
    <ytd-watch-flexy>
      <div id="primary">
        <video class="html5-main-video"></video>
        <ytd-watch-metadata>
          <div id="title"><h1><yt-formatted-string title="Ma vidéo de test">Ma vidéo de test</yt-formatted-string></h1></div>
          <div id="top-level-buttons-computed">
            <segmented-like-dislike-button-view-model>aime</segmented-like-dislike-button-view-model>
            <ytd-menu-renderer id="plus">...</ytd-menu-renderer>
          </div>
          <div id="owner"><ytd-channel-name id="channel-name"><div id="text"><a href="/@C">Ma Chaîne</a></div></ytd-channel-name></div>
          <ytd-watch-info-text><div id="info"><span>1 234 vues</span><span>il y a 2 jours</span></div></ytd-watch-info-text>
        </ytd-watch-metadata>
      </div>
      <div id="secondary"><div id="secondary-inner">
        <div id="vidiq-panel">vidIQ</div>
        <ytd-watch-next-secondary-results-renderer>suggestions</ytd-watch-next-secondary-results-renderer>
      </div></div>
    </ytd-watch-flexy>
    <span class="ytp-time-duration">10:00</span>
    <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript"
        visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED">${segs}</ytd-engagement-panel-section-list-renderer>
    <div id="bruit"></div>
  </body></html>`, { url: 'https://www.youtube.com/watch?v=abc123XYZ_1', runScripts: 'outside-only', virtualConsole: vc });

  const { window } = dom;
  const doc = window.document;
  const envois = [];

  window.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } },
    runtime: {
      sendMessage: (msg) => { envois.push(msg); return new Promise((r) => setTimeout(() => r(reponse), delai)); }
    }
  };
  window.navigator.clipboard = { writeText: async () => {} };

  const v = doc.querySelector('video');
  let cur = 0;
  Object.defineProperty(v, 'currentTime', { get: () => cur, set: (x) => { cur = x; }, configurable: true });
  Object.defineProperty(v, 'duration', { get: () => 600, configurable: true });
  v.play = () => Promise.resolve();

  global.window = window; global.document = doc; global.NodeFilter = window.NodeFilter;
  window.eval(lire('common.js'));
  window.eval(lire('transcript.js'));
  window.eval(lire('summary.js'));
  return { window, doc, envois, video: v, temps: () => cur };
}

const clic = (ctx, el) => el.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));

(async () => {
  console.log('1. Le bouton n’apparait qu’apres la copie');
  const ctx = page();
  await wait(1100);
  verifie('absent avant la copie', !ctx.doc.getElementById('yttools-summary-btn'));
  clic(ctx, ctx.doc.getElementById('yttools-transcript-btn'));
  await wait(1800);
  const btn = ctx.doc.getElementById('yttools-summary-btn');
  verifie('present apres la copie', !!btn);
  verifie('juste a droite du ☰',
    btn && btn.previousElementSibling && btn.previousElementSibling.id === 'yttools-transcript-btn');

  console.log('\n2. Le prompt envoye');
  clic(ctx, btn);
  await wait(60);
  const p = ctx.envois[0] && ctx.envois[0].prompt;
  verifie('message YTTOOLS_SUMMARIZE envoye', ctx.envois[0] && ctx.envois[0].type === 'YTTOOLS_SUMMARIZE');
  verifie('titre de la video', /Titre : Ma vidéo de test/.test(p));
  verifie('chaine', /Chaîne : Ma Chaîne/.test(p));
  verifie('les trois parties demandees', /## En bref/.test(p) && /## Déroulé/.test(p) && /## À retenir/.test(p));
  verifie('densite adaptee a la duree (10 min -> 8 lignes, une par minute)',
    /environ 8 lignes, à peu près une toutes les 1 minute/.test(p), (p.match(/\(environ[^)]*\)/) || [])[0]);
  verifie('un timecode exige sur CHAQUE ligne, y compris « À retenir »',
    /CHAQUE ligne de « Déroulé » et de « À retenir »/.test(p));
  verifie('modele de point cle avec timecode', /^- \[0:00\] /m.test(p));
  verifie('rappel du timecode apres la transcription',
    p.lastIndexOf('RAPPEL') > p.indexOf('Transcription :') && /timecode entre crochets/.test(p.slice(p.lastIndexOf('RAPPEL'))));
  verifie('transcription regroupee par tranches (moins de lignes que de segments)',
    (p.split('Transcription :')[1] || '').trim().split('\n').length < SEGMENTS.length,
    (p.split('Transcription :')[1] || '').trim().split('\n'));
  verifie('pas l’en-tete CSV', !/titre,chaine,debut/.test(p));

  console.log('\n3. Le panneau');
  const col = ctx.doc.getElementById('secondary-inner');
  let card = ctx.doc.getElementById('yttools-summary-card');
  verifie('en tete de la colonne de droite', card && col.firstElementChild === card);
  verifie('etat « en cours » pendant que Gemini redige', card && card.dataset.state === 'loading');
  verifie('bouton « Gemini redige… » desactive', btn.disabled && /rédige/.test(btn.textContent));
  await wait(500);
  card = ctx.doc.getElementById('yttools-summary-card');
  verifie('etat « ok » une fois la reponse arrivee', card && card.dataset.state === 'ok');
  verifie('trois titres', card.querySelectorAll('h3').length === 3);
  verifie('quatre puces', card.querySelectorAll('li').length === 4);
  const liens = [...card.querySelectorAll('a.yttools-ai-ts')].map((a) => a.textContent);
  verifie('timecodes devenus des liens', JSON.stringify(liens) === JSON.stringify(['0:00', '0:31', '0:58', '1:12']), liens);
  verifie('« 23:59 » au-dela de la fin : pas un lien', !liens.includes('23:59'));
  verifie('aucun HTML de Gemini injecte', !card.querySelector('script, img'));

  console.log('\n4. Cliquer un timecode deplace la lecture');
  clic(ctx, [...card.querySelectorAll('a.yttools-ai-ts')].find((a) => a.textContent === '0:31'));
  verifie('video amenee a 31 s', ctx.temps() === 31, ctx.temps());

  console.log('\n5. Le point en cours est surligne pendant la lecture');
  ctx.video.currentTime = 62;
  ctx.video.dispatchEvent(new ctx.window.Event('timeupdate'));
  const actif = card.querySelector('li.is-active');
  verifie('le point de 0:58 est actif a 1:02', actif && /La difficulté/.test(actif.textContent), actif && actif.textContent);
  verifie('un seul point actif', card.querySelectorAll('li.is-active').length === 1);

  console.log('\n6. Rouvrir ne redemande rien a Gemini');
  clic(ctx, card.querySelector('.yttools-ai-close'));
  verifie('panneau ferme', !ctx.doc.getElementById('yttools-summary-card'));
  clic(ctx, ctx.doc.getElementById('yttools-summary-btn'));
  await wait(50);
  verifie('panneau rouvert depuis le cache', !!ctx.doc.getElementById('yttools-summary-card'));
  verifie('toujours un seul envoi a Gemini', ctx.envois.length === 1, ctx.envois.length);

  console.log('\n7. Changer de video retire bouton et panneau');
  ctx.window.history.pushState({}, '', '/watch?v=autreVideo01');
  ctx.doc.getElementById('bruit').appendChild(ctx.doc.createElement('span'));
  await wait(1200);
  verifie('bouton retire', !ctx.doc.getElementById('yttools-summary-btn'));
  verifie('panneau retire', !ctx.doc.getElementById('yttools-summary-card'));

  console.log('\n8. Connexion Gemini demandee');
  {
    const c2 = page({ reponse: { ok: false, error: 'login' } });
    await wait(1100);
    clic(c2, c2.doc.getElementById('yttools-transcript-btn'));
    await wait(1800);
    clic(c2, c2.doc.getElementById('yttools-summary-btn'));
    await wait(500);
    const c = c2.doc.getElementById('yttools-summary-card');
    verifie('message clair', c && /connexion/i.test(c.textContent), c && c.textContent);
    verifie('bouton Reessayer', c && !!c.querySelector('.yttools-ai-retry'));
  }

  console.log('\n9. Le surlignage suit la frise, pas « À retenir »');
  {
    const c3 = page({ reponse: { ok: true, blocks: [
      { type: 'h', text: 'Déroulé' },
      { type: 'li', text: '[0:00] Début' },
      { type: 'li', text: '[0:30] Milieu' },
      { type: 'li', text: '[0:58] Fin' },
      { type: 'h', text: 'À retenir' },
      { type: 'li', text: '[0:10] Idée clé dite tôt' }
    ] } });
    await wait(1100);
    clic(c3, c3.doc.getElementById('yttools-transcript-btn'));
    await wait(1800);
    clic(c3, c3.doc.getElementById('yttools-summary-btn'));
    await wait(500);
    c3.video.currentTime = 40;
    c3.video.dispatchEvent(new c3.window.Event('timeupdate'));
    const actif = c3.doc.querySelector('#yttools-summary-card li.is-active');
    verifie('a 0:40, « Milieu » (0:30) est actif', actif && /Milieu/.test(actif.textContent), actif && actif.textContent);
    verifie('pas la ligne de « À retenir » placee plus bas', !(actif && /Idée clé/.test(actif.textContent)));
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
