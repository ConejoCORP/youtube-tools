/*
 * Popup : la roue crantee ouvre l'ecran Parametres, fait de cases cliquables
 * rangees par site (YouTube / Studio) et par section ; un clic active ou coupe
 * le reglage, le survol explique ce qu'il fait.
 */
const { EXT } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

async function popup({ ongletActif = 'https://www.youtube.com/watch?v=abc', reglages } = {}) {
  const html = fs.readFileSync(EXT + 'popup.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const vc = new VirtualConsole();
  const erreurs = [];
  vc.on('jsdomError', (e) => erreurs.push(String(e && e.message)));
  const dom = new JSDOM(html, { url: 'chrome-extension://abc/popup.html', runScripts: 'outside-only', virtualConsole: vc });
  const { window } = dom;
  const stock = reglages ? { yttoolsSettings: reglages } : {};
  window.chrome = {
    storage: { local: {
      get: async (k) => { const ks = Array.isArray(k) ? k : [k]; const o = {}; ks.forEach((x) => { if (x in stock) o[x] = stock[x]; }); return o; },
      set: async (o) => Object.assign(stock, o),
      remove: async () => {}
    } },
    tabs: {
      query: async (q) => (q && q.active ? [{ id: 1, url: ongletActif }] : []),
      sendMessage: async () => { throw new Error('pas de script'); },
      create: async () => {}
    },
    runtime: { getManifest: () => ({ version: '3.12.0' }), getURL: (p) => p },
    management: { getSelf: async () => ({ installType: 'normal' }) },
    action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} }
  };
  window.addEventListener('error', (e) => erreurs.push(String(e.message)));
  try {
    window.eval(fs.readFileSync(EXT + 'update-core.js', 'utf8'));
    window.eval(fs.readFileSync(EXT + 'popup.js', 'utf8'));
  } catch (e) { erreurs.push(String(e.message)); }
  await sleep(80);
  return { window, doc: window.document, stock, erreurs };
}

const clic = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

(async () => {
  console.log('1. Écran principal');
  {
    const { window, doc, erreurs } = await popup();
    verifie('aucune erreur au chargement', erreurs.length === 0, erreurs);
    verifie('plus aucun interrupteur de réglage sur l’écran principal', !doc.querySelector('#vueAccueil [role=switch]:not(#randomPos)'));
    verifie('roue crantée dans l’en-tête', !!doc.querySelector('header #ouvrirReglages svg'));
    verifie('écran Paramètres fermé au départ', doc.getElementById('vueReglages').hidden && !doc.getElementById('vueAccueil').hidden);

    clic(window, doc.getElementById('ouvrirReglages'));
    verifie('la roue ouvre les Paramètres, l’accueil disparaît', !doc.getElementById('vueReglages').hidden && doc.getElementById('vueAccueil').hidden);
    verifie('bouton « vider les champs » masqué dans les Paramètres', doc.getElementById('reset').hidden);
    verifie('version affichée', /Version 3\.12\.0/.test(doc.getElementById('version').textContent));

    const tuiles = () => Array.from(doc.querySelectorAll('#reglagesListe .tuile'));
    const sections = () => Array.from(doc.querySelectorAll('#reglagesListe .reglages-section')).map((s) => s.textContent);
    verifie('onglet YouTube par défaut', doc.querySelector('.site[data-site=youtube]').getAttribute('aria-selected') === 'true');
    verifie('YouTube : 7 cases, en 2 sections', tuiles().length === 7 && sections().join('|') === 'Page de la vidéo|Partout sur YouTube', sections());
    const etat = () => Object.fromEntries(tuiles().map((t) => [t.dataset.cle, t.getAttribute('aria-checked')]));
    verifie('états par défaut : tout actif sauf « Enregistrer un fichier »',
      JSON.stringify(etat()) === JSON.stringify({ transcriptButton: 'true', captureButton: 'true', rankBadge: 'true', watchTime: 'true', videosButton: 'true', playlistSearch: 'true', saveAsFile: 'false' }), etat());
    verifie('chaque case : icône + nom, et c’est un bouton à bascule', tuiles().every((t) => t.querySelector('svg path') && t.querySelector('.tuile-nom').textContent && t.getAttribute('role') === 'switch'));

    const aide = doc.getElementById('reglagesAide');
    const defaut = aide.textContent;
    const capture = tuiles().find((t) => t.dataset.cle === 'captureButton');
    capture.dispatchEvent(new window.MouseEvent('mouseenter'));
    verifie('survol : l’explication de la case s’affiche', /appareil photo/.test(aide.textContent), aide.textContent);
    capture.dispatchEvent(new window.MouseEvent('mouseleave'));
    verifie('fin du survol : texte d’aide par défaut', aide.textContent === defaut && /Clique sur une case/.test(defaut));

    clic(window, capture);
    await sleep(20);
    verifie('clic : la case se coupe', capture.getAttribute('aria-checked') === 'false');
    clic(window, tuiles().find((t) => t.dataset.cle === 'saveAsFile'));
    await sleep(20);
    verifie('clic : la case s’active', tuiles().find((t) => t.dataset.cle === 'saveAsFile').getAttribute('aria-checked') === 'true');

    clic(window, doc.querySelector('.site[data-site=studio]'));
    verifie('onglet Studio : 6 cases, en 3 sections',
      tuiles().map((t) => t.dataset.cle).join(',') === 'hideRevenue,studioTop10,retentionZoom,viewsTrend,publishTime,shortsRelated' &&
      sections().join('|') === 'Général|Tableau de bord et statistiques|Page Contenu', { t: tuiles().map((t) => t.dataset.cle), s: sections() });
    verifie('« Masquer les revenus » coupé par défaut', tuiles()[0].getAttribute('aria-checked') === 'false');

    doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    verifie('Échap : retour à l’accueil', doc.getElementById('vueReglages').hidden && !doc.getElementById('vueAccueil').hidden && !doc.getElementById('reset').hidden);
    clic(window, doc.getElementById('ouvrirReglages'));
    clic(window, doc.getElementById('retour'));
    verifie('« Retour » : retour à l’accueil', doc.getElementById('vueReglages').hidden);
    window.close();
  }

  console.log('\n2. Réglages enregistrés');
  {
    const p = await popup({ reglages: { captureButton: false, hideRevenue: true } });
    clic(p.window, p.doc.getElementById('ouvrirReglages'));
    const t = (cle) => p.doc.querySelector(`.tuile[data-cle="${cle}"]`);
    verifie('réglage enregistré relu (capture coupée)', t('captureButton').getAttribute('aria-checked') === 'false');
    clic(p.window, t('rankBadge'));
    await sleep(20);
    verifie('un clic enregistre, et garde les autres réglages',
      p.stock.yttoolsSettings.rankBadge === false && p.stock.yttoolsSettings.captureButton === false && p.stock.yttoolsSettings.hideRevenue === true,
      p.stock.yttoolsSettings);
    clic(p.window, p.doc.querySelector('.site[data-site=studio]'));
    verifie('onglet Studio : « Masquer les revenus » relu actif', t('hideRevenue').getAttribute('aria-checked') === 'true');
    clic(p.window, t('studioTop10'));
    await sleep(20);
    verifie('« Onglets Vidéos / Shorts » indépendant du classement de la page vidéo',
      p.stock.yttoolsSettings.studioTop10 === false && p.stock.yttoolsSettings.rankBadge === false);
    p.window.close();
  }

  console.log('\n3. Ouvert depuis YouTube Studio');
  {
    const p = await popup({ ongletActif: 'https://studio.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx' });
    clic(p.window, p.doc.getElementById('ouvrirReglages'));
    verifie('l’onglet Studio est affiché d’emblée', p.doc.querySelector('.site[data-site=studio]').getAttribute('aria-selected') === 'true');
    p.window.close();
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
