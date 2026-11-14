/*
 * Capture d'ecran sur la VRAIE page de lecture (dump) : place du bouton dans
 * la barre du lecteur, image a la resolution de la video, copie / fichier,
 * reglage, video pas prete, video protegee.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = EXT;
const lire = (f) => fs.readFileSync(DIR + f, 'utf8');
const HTML = lireDump();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

function page({ url = 'https://www.youtube.com/watch?v=lZGoJT4abos', reglages = {}, presse = true, protegee = false, prete = true } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const dom = new JSDOM(HTML, { url, runScripts: 'outside-only', virtualConsole: vc });
  const { window } = dom;
  const doc = window.document;

  const v = doc.querySelector('#movie_player video');
  Object.defineProperty(v, 'videoWidth', { get: () => (prete ? 1920 : 0) });
  Object.defineProperty(v, 'videoHeight', { get: () => (prete ? 1080 : 0) });
  Object.defineProperty(v, 'readyState', { get: () => (prete ? 4 : 0) });
  Object.defineProperty(v, 'currentTime', { get: () => 3725.4 });

  const dessins = [];
  window.HTMLCanvasElement.prototype.getContext = function () {
    const c = this;
    return { drawImage: (src, x, y, w, h) => dessins.push({ src, w, h, cw: c.width, ch: c.height }) };
  };
  window.HTMLCanvasElement.prototype.toBlob = function (cb, type) {
    if (protegee) throw new window.DOMException('tainted', 'SecurityError');
    cb(new window.Blob(['png'], { type }));
  };

  const copies = [];
  window.ClipboardItem = function (o) { this.types = Object.keys(o); };
  Object.defineProperty(window.navigator, 'clipboard', { value: {
    write: async (items) => { if (!presse) throw new Error('refus'); copies.push(items[0].types); },
    writeText: async () => {}
  }, configurable: true });

  window.chrome = {
    storage: { local: { get: async () => ({ yttoolsSettings: reglages }), set: async () => {} }, onChanged: { addListener: () => {} } }
  };
  global.window = window; global.document = doc; global.NodeFilter = window.NodeFilter;
  window.eval(lire('common.js'));
  const fichiers = [];
  window.__yttools.downloadBlob = (blob, nom) => { fichiers.push({ nom, type: blob.type }); return true; };
  window.eval(lire('capture.js'));
  return { window, doc, dessins, copies, fichiers };
}

const clic = (ctx, el) => el.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
const toast = (ctx) => (ctx.doc.getElementById('yttools-capture-toast') || {}).textContent;

(async () => {
  console.log('1. Le bouton dans la barre du lecteur');
  {
    const ctx = page();
    await sleep(1200);
    const b = ctx.doc.getElementById('yttools-capture-btn');
    verifie('present', !!b);
    verifie('dans les controles de droite du lecteur', b && b.parentElement.classList.contains('ytp-right-controls-left'));
    verifie('juste avant les sous-titres', b && b.nextElementSibling && b.nextElementSibling.classList.contains('ytp-subtitles-button'));
    verifie('style des boutons YouTube (ytp-button)', b && b.classList.contains('ytp-button'));
    verifie('un seul bouton', ctx.doc.querySelectorAll('#yttools-capture-btn').length === 1);

    console.log('\n2. Capture');
    let remonte = 0;
    ctx.doc.getElementById('movie_player').addEventListener('click', () => remonte++);
    clic(ctx, b);
    await sleep(50);
    verifie('image a la resolution de la video (1920x1080)',
      ctx.dessins.length === 1 && ctx.dessins[0].cw === 1920 && ctx.dessins[0].ch === 1080, ctx.dessins.map((d) => [d.cw, d.ch]));
    verifie('copiee en PNG', JSON.stringify(ctx.copies) === JSON.stringify([['image/png']]), ctx.copies);
    verifie('pas de fichier sans le reglage', ctx.fichiers.length === 0);
    verifie('message « Capture copiée »', toast(ctx) === 'Capture copiée', toast(ctx));
    verifie('message dans le lecteur (visible en plein ecran)',
      ctx.doc.getElementById('yttools-capture-toast').parentElement.id === 'movie_player');
    verifie('le clic ne remonte pas au lecteur (pas de pause)', remonte === 0, remonte);
  }

  console.log('\n3. Avec « Enregistrer un fichier »');
  {
    const ctx = page({ reglages: { saveAsFile: true } });
    await sleep(1200);
    clic(ctx, ctx.doc.getElementById('yttools-capture-btn'));
    await sleep(50);
    const f = ctx.fichiers[0];
    verifie('fichier .png enregistre en plus', f && f.type === 'image/png' && /\.png$/.test(f.nom), ctx.fichiers);
    verifie('nommé titre + instant (1h02m05s)', f && /_1h02m05s\.png$/.test(f.nom) && !/\s/.test(f.nom), f && f.nom);
    verifie('message « copiée et enregistrée »', toast(ctx) === 'Capture copiée et enregistrée', toast(ctx));
  }

  console.log('\n4. Presse-papiers refuse : le fichier prend le relais');
  {
    const ctx = page({ presse: false });
    await sleep(1200);
    clic(ctx, ctx.doc.getElementById('yttools-capture-btn'));
    await sleep(50);
    verifie('fichier enregistre quand meme', ctx.fichiers.length === 1);
    verifie('message « Capture enregistrée »', toast(ctx) === 'Capture enregistrée', toast(ctx));
  }

  console.log('\n5. Cas limites');
  {
    const a = page({ prete: false });
    await sleep(1200);
    clic(a, a.doc.getElementById('yttools-capture-btn'));
    await sleep(50);
    verifie('video pas chargee : message, rien de copie', toast(a) === 'Vidéo pas encore chargée' && a.copies.length === 0, toast(a));

    const p = page({ protegee: true });
    await sleep(1200);
    clic(p, p.doc.getElementById('yttools-capture-btn'));
    await sleep(50);
    verifie('video protegee : message clair, pas de plantage', toast(p) === 'Capture impossible sur cette vidéo', toast(p));

    const off = page({ reglages: { captureButton: false } });
    await sleep(1200);
    verifie('reglage desactive : pas de bouton', !off.doc.getElementById('yttools-capture-btn'));

    const accueil = page({ url: 'https://www.youtube.com/' });
    await sleep(1200);
    verifie('hors page de lecture : pas de bouton', !accueil.doc.getElementById('yttools-capture-btn'));
  }

  console.log('\n6. Horodatage du nom de fichier');
  {
    const ctx = page();
    const h = ctx.window.__yttoolsCapture.horodatage;
    verifie('65 s -> 1m05s', h(65) === '1m05s', h(65));
    verifie('3725 s -> 1h02m05s', h(3725) === '1h02m05s', h(3725));
    verifie('0 -> 0m00s', h(0) === '0m00s', h(0));
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
