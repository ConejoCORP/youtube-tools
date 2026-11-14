/*
 * Timecodes retrouves localement quand Gemini les oublie.
 * Points qui ressemblent a un passage -> son timecode, marque « estime » ;
 * points qui ne ressemblent a rien -> laisses sans timecode (on n'invente pas).
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const DIR = EXT;

let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

const vc = new VirtualConsole();
['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.youtube.com/watch?v=abc123XYZ_1', runScripts: 'outside-only', virtualConsole: vc });
const { window } = dom;
window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } };
global.window = window; global.document = window.document; global.NodeFilter = window.NodeFilter;
window.eval(fs.readFileSync(DIR + 'common.js', 'utf8'));
window.eval(fs.readFileSync(DIR + 'summary.js', 'utf8'));
const { horodater } = window.__yttoolsSummary;

// Une transcription ou chaque passage parle d'autre chose.
const rows = [];
const passages = [
  [0, 'Bonjour à tous, aujourd’hui on teste une voiture électrique'],
  [25, 'la batterie lithium tient environ quatre cents kilomètres en autonomie'],
  [50, 'la recharge rapide sur borne prend trente minutes seulement'],
  [75, 'le coffre est petit et les sièges arrière manquent de place'],
  [100, 'au final le prix reste élevé mais la conduite est agréable']
];
// Chaque passage est decoupe en segments, comme une vraie transcription.
for (const [debut, texte] of passages) {
  const mots = texte.split(' ');
  for (let i = 0; i < mots.length; i += 4) rows.push({ start: debut + i, text: mots.slice(i, i + 4).join(' ') });
}

const blocs = horodater([
  { type: 'h', text: 'Points clés' },
  { type: 'li', text: 'Autonomie de la batterie lithium : environ 400 kilomètres' },
  { type: 'li', text: '[0:50] Recharge rapide en trente minutes' },
  { type: 'li', text: 'Coffre petit, sièges arrière qui manquent de place' },
  { type: 'li', text: 'Le présentateur porte un pull rouge' },
  { type: 'p', text: 'Un paragraphe sans timecode ne doit pas en recevoir.' }
], rows);

const li = blocs.filter((b) => b.type === 'li');
verifie('point sur la batterie -> 0:25', li[0].text.startsWith('[0:25]'), li[0].text);
verifie('… marque comme estime', li[0].estimated === true);
verifie('point qui avait deja un timecode : intact', li[1].text === '[0:50] Recharge rapide en trente minutes' && !li[1].estimated);
verifie('point sur le coffre -> 1:15', li[2].text.startsWith('[1:15]'), li[2].text);
verifie('point sans rapport : aucun timecode invente', !/^\[/.test(li[3].text) && !li[3].estimated, li[3].text);
verifie('les paragraphes ne sont pas touches', blocs[blocs.length - 1].text === 'Un paragraphe sans timecode ne doit pas en recevoir.');

console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
process.exit(echecs ? 1 : 0);
