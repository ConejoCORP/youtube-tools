/*
 * YouTube Studio : revenus masques, fleches de tendance, zoom de la retention,
 * classement sur 10 Videos / Shorts. Structures HTML relevees sur le vrai
 * Studio (tableau de bord, page Contenu, statistiques d'une video).
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const DIR = EXT;
const lire = (f) => fs.readFileSync(DIR + f, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};
const CH = 'UCcXNrBbhJ2AwbtiPTzQCJ-A';

function page(html, { url, reglages = {}, fetch, scripts }) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const dom = new JSDOM(`<!doctype html><html lang="fr"><head></head><body>${html}</body></html>`, { url, runScripts: 'outside-only', virtualConsole: vc });
  const { window } = dom;
  const ecouteurs = [];
  let stocke = { ...reglages };
  window.chrome = {
    storage: {
      local: {
        get: async () => ({ yttoolsSettings: stocke }),
        set: async (o) => { if (o.yttoolsSettings) stocke = o.yttoolsSettings; }
      },
      onChanged: { addListener: (fn) => ecouteurs.push(fn) }
    }
  };
  if (fetch) window.fetch = fetch;
  for (const f of scripts) window.eval(lire(f));
  const regle = (patch) => {
    const avant = stocke;
    stocke = { ...stocke, ...patch };
    ecouteurs.forEach((fn) => fn({ yttoolsSettings: { oldValue: avant, newValue: stocke } }, 'local'));
  };
  return { window, doc: window.document, regle };
}

/* ====================================================================== */
async function testRevenus() {
  console.log('\n— Masquer les revenus');
  const html = `
    <div class="metric-row"><span class="label">Revenus estimés</span><span class="value" id="dash">4\u202f077,92\u00a0€</span></div>
    <div id="metric-total" class="yta-key-metric-block">2 247,57 €</div>
    <ytcp-video-row><div class="cell-body tablecell-views">499 442</div>
      <div class="cell-body tablecell-revenue right-align" role="cell"><div class="revenue-container ytcp-video-row" id="rowrev">2 247,57 €</div></div></ytcp-video-row>
    <a id="video-title">J'ai acheté un truc à 100 € pour voir</a>
    <div id="ctr">5,9 %</div>
    <div id="split"><span>12,30</span><span> €</span></div>
    <div id="usd">US$1.2K</div>
    <svg><g class="tick"><text class="label" id="axe"><tspan>2 000 €</tspan></text></g></svg>
    <div id="parent"><button id="onglet"><span id="dansbouton">61,52 €</span></button></div>
    <div class="tooltip">Votre plage type :<b id="plage">4 100,00 € à 5 100,00 €</b></div>`;
  const { window, doc, regle } = page(html, {
    url: 'https://studio.youtube.com/channel/' + CH,
    reglages: { hideRevenue: true },
    scripts: ['common.js', 'studio-revenus.js']
  });
  await sleep(50);
  const M = window.__yttoolsMoney;
  const marque = (id) => doc.getElementById(id).classList.contains('yttools-money');

  verifie('classe sur <html> quand le reglage est actif', doc.documentElement.classList.contains('yttools-hide-money'));
  verifie('montant du tableau de bord (espaces insecables) floute', marque('dash'));
  verifie('total de la carte des statistiques floute', marque('metric-total'));
  verifie('colonne revenus de la page Contenu floutee', marque('rowrev'));
  verifie('montant en dollars floute', marque('usd'));
  verifie('fourchette de l’infobulle « Votre plage type » floutée (vrais caractères de Studio)', marque('plage'));
  verifie('montant coupe en deux balises : le parent est floute', marque('split'));
  verifie('texte SVG : la balise <text> porte la marque', marque('axe'));
  verifie('titre qui cite un prix : PAS floute', !marque('video-title'));
  verifie('vues et pourcentage : PAS floutes', !doc.querySelector('.tablecell-views').classList.contains('yttools-money') && !marque('ctr'));

  // Un montant qui arrive (infobulle d'un graphique) est marque avant tout affichage.
  const bulle = doc.createElement('div');
  bulle.id = 'bulle';
  bulle.textContent = '1 234,00 €';
  doc.body.append(bulle);
  await Promise.resolve(); await sleep(0);
  verifie('montant ajoute apres coup : floute', marque('bulle'));

  // Studio reutilise l'element et y met autre chose : la marque s'en va.
  bulle.firstChild.nodeValue = '499 442';
  await sleep(0);
  verifie('element reutilise pour un autre chiffre : marque retiree', !marque('bulle'));
  bulle.firstChild.nodeValue = '9,99 €';
  await sleep(0);
  verifie('… et remise quand il redevient un montant', marque('bulle'));

  // Clic : devoile, sans declencher l'onglet ; le second clic agit normalement.
  let clicsParent = 0;
  doc.getElementById('parent').addEventListener('click', () => clicsParent++);
  const ev1 = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  doc.getElementById('dansbouton').dispatchEvent(ev1);
  verifie('1er clic : montant devoile', doc.getElementById('dansbouton').classList.contains('yttools-money-shown'));
  verifie('1er clic : consomme (ni action, ni propagation)', ev1.defaultPrevented && clicsParent === 0, { prevented: ev1.defaultPrevented, clicsParent });
  doc.getElementById('dansbouton').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  verifie('2e clic : agit normalement', clicsParent === 1, clicsParent);

  verifie('reconnaissance : variantes', ['+12,30 €', '€1.2M', '$0.00', '1,2 k €', '−3,50 €', '12 345 678,90 EUR'].every(M.estMontant));
  verifie('reconnaissance : pas des montants', !['499 442', '5,9 %', '€', 'Revenus estimés', '100 € offerts à gagner ce soir', '430 k – 570 k', 'de 5 à 10 €uros'].some(M.estMontant));
  verifie('reconnaissance : fourchettes', ['430 € – 570 €', '$1.2K to $3.4K', '4 100,00 € à 5 100,00 €'].every(M.estMontant));

  regle({ hideRevenue: false });
  verifie('reglage coupe : plus de flou', !doc.documentElement.classList.contains('yttools-hide-money'));
  const apres = doc.createElement('div');
  apres.id = 'apres';
  apres.textContent = '5,00 €';
  doc.body.append(apres);
  await sleep(0);
  verifie('reglage coupe : plus aucune surveillance', !marque('apres'));
  window.close();
}

/* ====================================================================== */
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const dateFr = (t) => { const d = new Date(t); return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`; };
const id11 = (n) => ('vid' + String(n).padStart(8, '0')).slice(0, 11);

function ligne({ n, jours, vues, publique = true }) {
  const t = Date.now() - jours * 86400e3;
  return `<ytcp-video-row class="ytcp-video-section-content" role="row"><div id="row-container" class="ytcp-video-row">
    <div class="cell-body tablecell-video floating-column last-floating-column ytcp-video-row" role="cell"><ytcp-video-list-cell-video class="ytcp-video-row">
      <div id="video-thumbnail"><a id="thumbnail-anchor" href="/video/${id11(n)}/edit"></a></div>
      <div class="right-section"><a id="video-title" class="remove-default-style" href="/video/${id11(n)}/edit"><span>Vidéo ${n}</span></a></div>
    </ytcp-video-list-cell-video></div>
    <div class="cell-body tablecell-visibility ytcp-video-row" role="cell"><div><div class="icon-text-edit-triangle-wrap editable">
      <yt-icon class="left-icon icon-grey ${publique ? 'privacy-public-icon' : 'privacy-private-icon'} ytcp-video-row"></yt-icon><span class="label-span">${publique ? 'Publique' : 'Privée'}</span></div></div></div>
    <div class="cell-body tablecell-date sortable column-sorted ytcp-video-row" role="cell">
        ${dateFr(t)}
      <div class="cell-description ytcp-video-row">${publique ? 'Publiée' : 'Mise en ligne'}</div></div>
    <div class="cell-body tablecell-views sortable right-align ytcp-video-row" role="cell">
        ${vues.toLocaleString('fr-FR').replace(/\u202f/g, ' ')}
      </div>
    <div class="cell-body tablecell-revenue right-align ytcp-video-row" role="cell"><div class="revenue-container">1,00 €</div></div>
  </div></ytcp-video-row>`;
}

async function testTendance() {
  console.log('\n— Flèches de tendance (page Contenu)');
  // Liste triee par date, comme Studio : une video par semaine.
  const specs = [
    { n: 0, jours: 0.5, vues: 50000 },                 // < 24 h : pas de fleche
    { n: 1, jours: 7, vues: 5000000 },                 // carton : en haut
    { n: 2, jours: 14, vues: 30000 },                  // flop : en bas
    { n: 3, jours: 18, vues: 999999, publique: false },// privee : ni fleche, ni reference
    { n: 4, jours: 21, vues: 0 },                      // calcule a part (« dans la normale »)
    { n: 5, jours: 28, vues: 520000 }, { n: 6, jours: 35, vues: 480000 },
    { n: 7, jours: 42, vues: 610000 }, { n: 8, jours: 49, vues: 450000 },
    { n: 9, jours: 56, vues: 500000 }, { n: 10, jours: 63, vues: 700000 },
    { n: 11, jours: 70, vues: 400000 }, { n: 12, jours: 77, vues: 560000 },
    { n: 13, jours: 84, vues: 530000 }, { n: 14, jours: 91, vues: 470000 },
    { n: 15, jours: 98, vues: 650000 }, { n: 16, jours: 105, vues: 380000 }
  ];
  // Vues de la n°4 : pile au milieu de la fourchette de ses 10 predecesseures publiques, a son age.
  const RK = require(DIR + 'rank-core.js');
  const now = Date.now();
  const age4 = (21 * 86400e3) / 3600e3;
  const refs4 = specs.filter((s) => s.n > 4 && s.publique !== false).slice(0, 10);
  const est = refs4.map((r) => r.vues * RK.growth(age4) / RK.growth(r.jours * 24)).sort((a, b) => a - b);
  specs[4].vues = Math.round((est[2] + est[7]) / 2);

  const { window, doc, regle } = page(specs.map(ligne).join(''), {
    url: `https://studio.youtube.com/channel/${CH}/videos/upload?filter=%5B%5D`,
    scripts: ['common.js', 'rank-core.js', 'studio-tendance.js']
  });
  await sleep(400);
  const fleche = (n) => {
    const row = Array.from(doc.querySelectorAll('ytcp-video-row'))[n];
    const s = row.querySelector('.tablecell-views .yttools-trend');
    return s && s.dataset.trend !== 'none' ? s.dataset.trend : null;
  };
  const T = window.__yttoolsTrend;

  verifie('dates : « 13 juin 2026 », « 3 janv. 2026 », « 15 déc. 2025 », « Jun 13, 2026 »',
    new Date(T.lireDate('13 juin 2026')).getMonth() === 5 && new Date(T.lireDate('3 janv. 2026')).getDate() === 3 &&
    new Date(T.lireDate('15 déc. 2025')).getMonth() === 11 && new Date(T.lireDate('Jun 13, 2026')).getDate() === 13 &&
    new Date(T.lireDate('1 août 2025')).getMonth() === 7 && T.lireDate('n’importe quoi') === null);
  verifie('vues lues sur la vraie cellule (« 499 442 »)', T.lireLigne(doc.querySelectorAll('ytcp-video-row')[5]).vues === 520000);
  verifie('carton : flèche vers le haut', fleche(1) === 'up', fleche(1));
  verifie('flop : flèche vers le bas', fleche(2) === 'down', fleche(2));
  verifie('dans la fourchette : flèche neutre', fleche(4) === 'same', { f: fleche(4), vues: specs[4].vues, bas: est[2], haut: est[7] });
  verifie('vidéo de moins de 24 h : pas de flèche', fleche(0) === null);
  verifie('vidéo privée : pas de flèche', fleche(3) === null);
  verifie('fin de liste (moins de 4 précédentes) : pas de flèche', fleche(14) === null && fleche(15) === null && fleche(16) === null);
  verifie('colonne alignée : un emplacement (flèche ou vide) dans CHAQUE cellule',
    Array.from(doc.querySelectorAll('.tablecell-views')).every((c) => c.querySelectorAll('.yttools-trend').length === 1));
  verifie('emplacement vide : sans icône, ignoré des lecteurs d’écran',
    (() => { const v = doc.querySelectorAll('ytcp-video-row')[3].querySelector('.yttools-trend'); return v.dataset.trend === 'none' && !v.querySelector('svg') && v.getAttribute('aria-hidden') === 'true'; })());
  verifie('la flèche suit le nombre, dans la même cellule', !!doc.querySelectorAll('ytcp-video-row')[1].querySelector('.tablecell-views > .yttools-trend svg'));
  const bulle = doc.querySelectorAll('ytcp-video-row')[1].querySelector('.yttools-trend').title;
  verifie('infobulle : la normale estimée', /Au-dessus de la normale/.test(bulle) && /D'habitude .+ vues à 7 jours/.test(bulle), bulle);

  // La privee ne compte pas : la n°2 est comparee aux 10 publiques suivantes, pas a la privee.
  const res = T.tendances(Array.from(doc.querySelectorAll('ytcp-video-row')).map(T.lireLigne), now);
  verifie('la vidéo privée n’entre pas dans la normale', res.get(id11(2)).n === 10 && res.get(id11(2)).haut < 999999 * 0.9);

  // Le temps passe entre deux verifications (les estimations bougent avec l'age) :
  // la fleche ne doit pas etre refaite pour autant.
  const avant = doc.querySelectorAll('ytcp-video-row')[1].querySelector('.yttools-trend');
  await sleep(2300);
  T.maj();
  verifie('mise à jour sans changement : la flèche n’est pas recréée', doc.querySelectorAll('ytcp-video-row')[1].querySelector('.yttools-trend') === avant);

  // Tri par vues : l'ordre de la page change, pas le resultat.
  const parent = doc.querySelector('ytcp-video-row').parentElement;
  const rows = Array.from(doc.querySelectorAll('ytcp-video-row'));
  rows.reverse().forEach((r) => parent.append(r));
  T.maj();
  verifie('liste retriée : mêmes flèches', fleche(15) === 'up' && fleche(14) === 'down', [fleche(15), fleche(14)]);

  regle({ viewsTrend: false });
  verifie('réglage coupé : flèches retirées', !doc.querySelector('.yttools-trend'));
  regle({ viewsTrend: true });
  verifie('réglage remis : flèches revenues', !!doc.querySelector('.yttools-trend'));
  window.close();

  // Hors de la page Contenu : rien.
  const p2 = page(specs.map(ligne).join(''), { url: `https://studio.youtube.com/channel/${CH}`, scripts: ['common.js', 'rank-core.js', 'studio-tendance.js'] });
  await sleep(400);
  verifie('hors page Contenu : aucune flèche', !p2.doc.querySelector('.yttools-trend'));
  p2.window.close();
  const p3 = page(specs.map(ligne).join(''), { url: `https://studio.youtube.com/channel/${CH}/videos/short`, scripts: ['common.js', 'rank-core.js', 'studio-tendance.js'] });
  await sleep(400);
  verifie('onglet Shorts de la page Contenu : flèches aussi', !!p3.doc.querySelector('.yttools-trend'));
  p3.window.close();
}

/* ====================================================================== */
// Courbe de retention : ~100 points, pixels entiers, comme le trace de Studio.
function trace() {
  const pts = [[0, 13], [0, 13]];
  for (let x = 6; x <= 604; x += 6) {
    const y = Math.round(160 - (38 + 50 * Math.exp(-x / 40) + 3 * Math.sin(x / 25)) * 1.6);
    pts.push([x, y]);
  }
  return 'M' + pts.map((p) => p.join(',')).join('L');
}

const SVG_RETENTION = (d) => `
<svg class="aplos-chart aplos-chart-svg style-scope yta-line-chart-base" aria-hidden="true" width="656" height="200">
  <g class="aplos-draw-area style-scope yta-line-chart-base" transform="translate(4,16)">
    <g class="x axis" transform="translate(0, 160)">
      <g class="tick first-tick" transform="translate(0,0)"><text class="label"><tspan x="0">0:00</tspan></text></g>
      <g class="tick" transform="translate(302,0)"><text class="label"><tspan x="0">10:21</tspan></text></g>
      <g class="tick last-tick" transform="translate(604,0)"><text class="label"><tspan x="0">20:42</tspan></text></g>
    </g>
    <g class="y axis" opacity="0"></g>
    <g class="y2 axis" transform="translate(604, 0)">
      <g class="tick first-tick" transform="translate(0,0)"><text class="label"><tspan x="16">100 %</tspan></text></g>
      <g class="tick" transform="translate(0,54.39999999999999)"><text class="label"><tspan x="16">66 %</tspan></text></g>
      <g class="tick" transform="translate(0,107.19999999999999)"><text class="label"><tspan x="16">33 %</tspan></text></g>
      <g class="tick last-tick" transform="translate(0,160)"><text class="label"><tspan x="16">0 %</tspan></text></g>
    </g>
    <rect class="mouseCapturePane" width="604" height="160" style="opacity: 0;"></rect>
    <g class="seriesGroups"><g series-id="AUDIENCE_RETENTION_HIGHLIGHTS_CHART_RETENTION_DATA">
      <g class="line-segments">
        <path class="line-series" fill="none" stroke="rgba(47, 165, 203, 1)" d="${d}" stroke-width="2"></path>
        <path class="event-target" fill="none" stroke="transparent" opacity="0" d="${d}" stroke-width="10"></path>
      </g></g></g>
    <g class="dot-follow-layer" style="display: none;"></g>
  </g>
</svg>`;

const PAGE_RETENTION = (d) => `
<yta-audience-retention-highlights-video-card-v2><yta-card-container><tp-yt-paper-card><div class="content">
  <video id="lecteur"></video>
  <ytcp-ve><yta-audience-retention-highlights-player-and-chart-v2>
    <yta-line-chart-base id="chart"><div id="chart-container"><div class="aplos-chart-container aplos-chart aplos-style">${SVG_RETENTION(d)}</div></div></yta-line-chart-base>
  </yta-audience-retention-highlights-player-and-chart-v2></ytcp-ve>
</div></tp-yt-paper-card></yta-card-container></yta-audience-retention-highlights-video-card-v2>
<yta-key-metric-card><yta-line-chart-base id="autre"><div id="chart-container"><div class="aplos-chart-container">${SVG_RETENTION(d).replace('aplos-chart aplos', 'aplos-chart autre aplos')}</div></div></yta-line-chart-base></yta-key-metric-card>`;

async function testRetention() {
  console.log('\n— Zoom dans le graphique de rétention');
  const d = trace();
  const { window, doc, regle } = page(PAGE_RETENTION(d), {
    url: 'https://studio.youtube.com/video/mnNqvIdQ8ik/analytics/tab-overview/period-default',
    scripts: ['common.js', 'studio-retention.js']
  });
  // Geometrie a l'ecran : la zone de trace occupe x 100..704, y 50..210.
  const R = { left: 100, top: 50, width: 604, height: 160, right: 704, bottom: 210, x: 100, y: 50 };
  window.Element.prototype.getBoundingClientRect = function () {
    return this.matches && this.matches('rect.mouseCapturePane, .yttools-rz-fond') ? R : { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  const vid = doc.getElementById('lecteur');
  let tCourant = 0;
  let enPause = true;
  Object.defineProperty(vid, 'duration', { get: () => 1242 });
  Object.defineProperty(vid, 'currentTime', { get: () => tCourant, set: (v) => { tCourant = v; } });
  Object.defineProperty(vid, 'paused', { get: () => enPause });
  await sleep(100);
  const Z = window.__yttoolsRetention;
  Z.scan();

  const svg = doc.querySelector('svg.aplos-chart-svg');
  const hote = svg.parentElement;
  const st = () => Z.etats.get(svg);
  const molette = (cible, x, deltaY, o = {}) => {
    const e = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: 130, deltaY, deltaX: o.deltaX || 0, shiftKey: !!o.shiftKey });
    cible.dispatchEvent(e);
    return e;
  };
  const souris = (type, cible, x, o = {}) => {
    const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 130, button: 0, ...o });
    cible.dispatchEvent(e);
    return e;
  };

  const g = Z.lire(svg);
  verifie('lecture : zone 604 x 160, durée 20:42', g.w === 604 && g.h === 160 && Math.round(g.duree) === 1242, { w: g.w, h: g.h, duree: g.duree });
  verifie('lecture : ~100 points, en % via l’axe de droite', g.series[0].vals.length === 101 && Math.abs(g.series[0].vals[0].r - 91.875) < 0.01, { n: g.series[0].vals.length, r0: g.series[0].vals[0].r });

  // Ecouteurs du graphique de Studio : ils ne doivent rien voir pendant le zoom.
  let natifs = 0;
  svg.querySelector('rect.mouseCapturePane').addEventListener('mousemove', () => natifs++);
  souris('mousemove', svg.querySelector('rect.mouseCapturePane'), 300);
  verifie('sans zoom : le graphique de Studio reçoit la souris', natifs === 1);

  const bas0 = molette(svg.querySelector('rect.mouseCapturePane'), 402, 100);
  verifie('sans zoom, molette vers le bas : la page défile (rien d’intercepté)', !bas0.defaultPrevented && !st().view);

  const e1 = molette(svg.querySelector('rect.mouseCapturePane'), 402, -100);
  verifie('molette vers le haut : zoom', !!st().view && svg.classList.contains('yttools-rz-on') && e1.defaultPrevented);
  const span1 = st().view.to - st().view.from;
  verifie('un cran ≈ ×1,25', Math.abs(span1 - Math.exp(-0.22)) < 1e-6, span1);
  const tSous = (x) => st().view.from + (x - 100) / 604 * (st().view.to - st().view.from);
  const t1 = tSous(402);
  for (let i = 0; i < 6; i++) molette(doc.querySelector('.yttools-rz-fond'), 402, -100);
  verifie('l’instant pointé reste sous la souris', Math.abs(tSous(402) - t1) < 1e-9, { avant: t1, apres: tSous(402) });
  verifie('le graphique de Studio est masqué, pas supprimé', !!svg.querySelector('path.line-series') && !!svg.querySelector('g.aplos-draw-area > .yttools-rz-layer'));

  const labels = Array.from(svg.querySelectorAll('.yttools-rz-layer .yttools-rz-txt')).map((t) => t.textContent);
  const pcts = labels.filter((l) => /%/.test(l)).map((l) => parseFloat(l.replace(',', '.')));
  verifie('échelle des % resserrée sur la portion visible', pcts.length >= 2 && Math.max(...pcts) - Math.min(...pcts) < 40 && !labels.includes('100 %'), labels);
  verifie('axe du temps zoomé (5 repères m:ss)', labels.filter((l) => /^\d+:\d\d$/.test(l)).length === 5, labels);
  verifie('points de mesure visibles une fois zoomé', svg.querySelectorAll('.yttools-rz-point').length > 3);
  verifie('indication du zoom et du double-clic', /Zoom ×.+double-clic pour revenir/.test(svg.querySelector('.yttools-rz-info').textContent));

  natifs = 0;
  souris('mousemove', doc.querySelector('.yttools-rz-fond'), 350);
  verifie('zoomé : le graphique de Studio ne voit plus la souris', natifs === 0);
  const bulle = svg.querySelector('.yttools-rz-bulle text');
  verifie('survol : instant et pourcentage', !!bulle && /^\d+:\d\d\s+\d+(,\d)?\s%$/.test(bulle.textContent.replace(/\u202f|\u00a0/g, ' ')), bulle && bulle.textContent);

  const vAvant = { ...st().view };
  molette(doc.querySelector('.yttools-rz-fond'), 402, 0, { deltaX: 120 });
  const vApres = st().view;
  verifie('molette horizontale : on se déplace, même largeur', vApres.from > vAvant.from && Math.abs((vApres.to - vApres.from) - (vAvant.to - vAvant.from)) < 1e-12);

  // Glisser vers la droite : la courbe suit, la vue recule.
  const f0 = st().view.from;
  souris('mousedown', doc.querySelector('.yttools-rz-fond'), 400);
  souris('mousemove', doc.querySelector('.yttools-rz-fond'), 460);
  souris('mousemove', doc.body, 520);                       // le glisser continue hors du graphique
  souris('mouseup', doc.body, 520);
  verifie('glisser : la vue se déplace', st().view.from < f0, { avant: f0, apres: st().view.from });
  souris('click', doc.querySelector('.yttools-rz-fond'), 520);
  verifie('clic après un glisser : la lecture ne bouge pas', tCourant === 0);
  souris('click', doc.querySelector('.yttools-rz-fond'), 402);
  const attendu = tSous(402) * 1242;
  verifie('clic : la vidéo va à l’instant pointé', Math.abs(tCourant - attendu) < 1e-6, { tCourant, attendu });

  // Lecture en cours au bord droit : la vue suit.
  tCourant = st().view.to * 1242 - 0.1;
  enPause = false;
  await sleep(400);
  verifie('lecture au bord droit : la vue se décale', st().view.from < tCourant / 1242 && st().view.to > tCourant / 1242 + 0.5 * (st().view.to - st().view.from), st().view);
  enPause = true;

  // Studio redessine sa courbe (autre periode, redimensionnement) : on suit.
  const ancien = svg.querySelector('.yttools-rz-courbe').getAttribute('d');
  // Changement NON lineaire : un decalage uniforme serait absorbe par l'echelle adaptative.
  const d2 = d.replace(/L(\d+),(\d+)/g, (m, x, y) => `L${x},${Math.min(160, +y + (+x % 12 === 0 ? 15 : 0))}`);
  svg.querySelectorAll('path.line-series, path.event-target').forEach((p) => p.setAttribute('d', d2));
  Z.scan();
  verifie('courbe redessinée par Studio : la vue zoomée suit', svg.querySelector('.yttools-rz-courbe').getAttribute('d') !== ancien);

  souris('dblclick', doc.querySelector('.yttools-rz-fond'), 402);
  verifie('double-clic : retour à la vue d’origine', !st().view && !svg.classList.contains('yttools-rz-on') && !svg.querySelector('.yttools-rz-layer'));

  // Dezoomer jusqu'au bout revient aussi a l'origine.
  molette(svg.querySelector('rect.mouseCapturePane'), 402, -100);
  for (let i = 0; i < 5; i++) molette(doc.querySelector('.yttools-rz-fond') || svg.querySelector('rect.mouseCapturePane'), 402, 100);
  verifie('dézoomer jusqu’au bout : vue d’origine', !st().view);

  const autre = doc.querySelector('svg.autre');
  const eA = molette(autre.querySelector('rect.mouseCapturePane'), 402, -100);
  verifie('autre graphique (pas la rétention) : aucun zoom', !eA.defaultPrevented && !autre.classList.contains('yttools-rz-on'));

  molette(svg.querySelector('rect.mouseCapturePane'), 402, -100);
  regle({ retentionZoom: false });
  verifie('réglage coupé : vue d’origine', !st().view && !svg.classList.contains('yttools-rz-on'));
  const eOff = molette(svg.querySelector('rect.mouseCapturePane'), 402, -100);
  verifie('réglage coupé : la molette ne zoome plus', !eOff.defaultPrevented && !st().view);
  window.close();
}

/* ====================================================================== */
function grille(items) {
  return { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content: { richGridRenderer: { contents: items } } } }] } } };
}
const video = (id, titre, vues, age) => ({ richItemRenderer: { content: { lockupViewModel: {
  contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
  metadata: { lockupMetadataViewModel: { title: { content: titre }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: vues } }, { text: { content: age } }] }] } } } } } } } });
const short = (id, titre, vues) => ({ richItemRenderer: { content: { shortsLockupViewModel: {
  onTap: { innertubeCommand: { reelWatchEndpoint: { videoId: id } } },
  overlayMetadata: { primaryText: { content: titre }, secondaryText: { content: vues } } } } } });

const CARTE = `
<ytcd-entity-snapshot-item class="ytcd-item"><div id="video-snapshot" class="ytcd-entity-snapshot-item">
  <h2 id="entity-snapshot-title" class="title apply-item-padding">Performances de la dernière vidéo</h2>
  <div class="thumbnail-container"></div>
  <tp-yt-iron-collapse class="iron-collapse-opened"><div id="analytics-section"><yta-entity-snapshot><div id="entity-snapshot">
    <div id="metrics-table" class="layout vertical"><div id=" -row" class="table-row"><div class="metric-name">Classement par vues</div>
      <div><div id="table-ranking" role="gridcell"><span class="table-value">6 sur 10</span></div></div></div></div>
  </div></yta-entity-snapshot></div></tp-yt-iron-collapse>
  <div id="link-button-container" class="button-horizontal-padding"><a href="/video/mnNqvIdQ8ik/analytics/tab-overview/period-default"></a></div>
</div></ytcd-entity-snapshot-item>`;

async function testTop10() {
  console.log('\n— Classement sur 10, Vidéos / Shorts (tableau de bord)');
  const vids = [
    video('vidLATEST01', 'Latest video', '210K views', '2 weeks ago'),
    ...Array.from({ length: 11 }, (_, i) => video(`vidOLDER${String(i).padStart(3, '0')}`, `Older ${i}`, `${(i + 2) * 100}K views`, `${i + 3} weeks ago`))
  ];
  const shorts = Array.from({ length: 12 }, (_, i) => short(`shrt${String(i).padStart(7, '0')}`, `Short ${i}`, `${(12 - i) * 1.5}M views`));
  const requetes = [];
  const fetchMock = async (url, opts) => {
    const corps = JSON.parse(opts.body);
    requetes.push({ url, credentials: opts.credentials, corps });
    const items = corps.params === 'EgZzaG9ydHPyBgUKA5oBAA==' ? shorts : vids;
    const fr = corps.context.client.hl === 'fr';
    const json = grille(fr ? JSON.parse(JSON.stringify(items).replace(/"Latest video"/, '"Dernière vidéo (FR)"')) : items);
    return { ok: true, status: 200, json: async () => json };
  };
  const { window, doc, regle } = page(CARTE, {
    url: `https://studio.youtube.com/channel/${CH}`,
    fetch: fetchMock,
    scripts: ['common.js', 'rank-core.js', 'studio-top10.js']
  });
  await sleep(1500);
  const bloc = doc.getElementById('yttools-top10');
  verifie('bloc posé dans la carte, avant les boutons', !!bloc && bloc.nextElementSibling && bloc.nextElementSibling.id === 'link-button-container');
  verifie('onglets Vidéos / Shorts, Vidéos sélectionné', Array.from(bloc.querySelectorAll('[role=tab]')).map((b) => b.textContent + ':' + b.getAttribute('aria-selected')).join(',') === 'Vidéos:true,Shorts:false');
  const r0 = requetes[0];
  verifie('requête publique : www.youtube.com, sans clé, sans cookie', r0 && /^https:\/\/www\.youtube\.com\/youtubei\/v1\/browse\?prettyPrint=false$/.test(r0.url) && r0.credentials === 'omit', r0 && { url: r0.url, cred: r0.credentials });
  verifie('requête : chaîne, onglet Vidéos, client web public', r0 && r0.corps.browseId === CH && r0.corps.params === 'EgZ2aWRlb3PyBgQKAjoA' && r0.corps.context.client.clientName === 'WEB');
  const lignes = Array.from(bloc.querySelectorAll('.yttools-t10-ligne'));
  verifie('10 lignes, la dernière vidéo mise en avant', lignes.length === 10 && lignes.filter((l) => l.classList.contains('is-current')).length === 1);
  const cur = bloc.querySelector('.is-current');
  verifie('titre dans la langue de Studio', cur && /Dernière vidéo \(FR\)/.test(cur.textContent), cur && cur.textContent);
  verifie('rang affiché « Xe sur 10 »', /^\d+(re|e) sur 10$/.test(bloc.querySelector('.yttools-t10-rang').textContent), bloc.querySelector('.yttools-t10-rang').textContent);
  verifie('vidéos : estimation à âge égal (≈)', bloc.querySelectorAll('.yttools-t10-vues').length === 10 && Array.from(bloc.querySelectorAll('.yttools-t10-ligne:not(.is-current) .yttools-t10-vues')).every((v) => /^≈ /.test(v.textContent)));
  verifie('lien vers les statistiques Studio de chaque vidéo', /^\/video\/vid[\w-]{8}\/analytics\/tab-overview\/period-default$/.test(lignes[0].getAttribute('href')));
  const nVideo = requetes.length;
  verifie('onglet Vidéos : 2 requêtes au plus (liste + titres en français)', nVideo <= 2, nVideo);
  verifie('onglet Shorts PAS chargé tant qu’il n’est pas ouvert', requetes.every((r) => r.corps.params !== 'EgZzaG9ydHPyBgUKA5oBAA=='));

  bloc.querySelector('[data-format=short]').click();
  await sleep(300);
  verifie('onglet Shorts : liste des Shorts', requetes.some((r) => r.corps.params === 'EgZzaG9ydHPyBgUKA5oBAA==') && /Dernier Short/.test(bloc.textContent));
  const shortsLignes = Array.from(bloc.querySelectorAll('.yttools-t10-ligne'));
  verifie('Shorts : 10 lignes, vues actuelles (pas d’estimation)', shortsLignes.length === 10 && !bloc.querySelector('.yttools-t10-vues').textContent.startsWith('≈'));
  verifie('Shorts : jamais de vidéo longue dans la liste', shortsLignes.every((l) => /\/video\/shrt/.test(l.getAttribute('href'))));
  const n = requetes.length;
  bloc.querySelector('[data-format=video]').click();
  await sleep(100);
  verifie('retour sur Vidéos : aucune nouvelle requête', requetes.length === n && bloc.querySelectorAll('.yttools-t10-ligne').length === 10 && /Dernière vidéo/.test(bloc.textContent));

  regle({ studioTop10: false });
  await sleep(200);
  verifie('case « Onglets Vidéos / Shorts » coupée : bloc retiré', !doc.getElementById('yttools-top10'));
  window.close();

  // Pas sur le tableau de bord : rien, et aucune requete.
  const req2 = [];
  const p2 = page(CARTE, { url: `https://studio.youtube.com/channel/${CH}/videos/upload`, fetch: async (u, o) => { req2.push(u); return fetchMock(u, o); }, scripts: ['common.js', 'rank-core.js', 'studio-top10.js'] });
  await sleep(1200);
  verifie('hors tableau de bord : ni bloc, ni requête', !p2.doc.getElementById('yttools-top10') && req2.length === 0);
  p2.window.close();
}

(async () => {
  await testRevenus();
  await testTendance();
  await testRetention();
  await testTop10();
  console.log(echecs ? `\n${echecs} ECHEC(S)` : '\ntout passe');
  process.exit(echecs ? 1 : 0);
})();
