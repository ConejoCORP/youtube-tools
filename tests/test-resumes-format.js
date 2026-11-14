/*
 * Lecture des reponses de Gemini, quelle que soit la facon dont il les a mises
 * en forme : resume de la video (chapitres et references) et resume des
 * commentaires (pourcentages et camps). Aucune requete : on donne directement
 * les blocs tels que gemini-writer.js les renvoie.
 */
const { EXT } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

const vc = new VirtualConsole();
['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
const dom = new JSDOM('<!doctype html><html lang="fr"><body></body></html>',
  { url: 'https://www.youtube.com/watch?v=abc123XYZ_1', runScripts: 'outside-only', virtualConsole: vc });
const { window } = dom;
window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener: () => {} } } };
global.window = window; global.document = window.document; global.NodeFilter = window.NodeFilter;
for (const f of ['common.js', 'summary.js', 'comments.js']) window.eval(fs.readFileSync(EXT + f, 'utf8'));
const { structurer, separerRef, completerRefs } = window.__yttoolsSummary;
const { structurerAvis, rendreAvis } = window.__yttoolsComments;

const h = (text, level = 3) => ({ type: 'h', level, text });
const li = (text, depth = 0) => ({ type: 'li', depth, text });
const p = (text) => ({ type: 'p', text });
const resume = (s) => s && s.chapitres.map((c) => `${c.titre}@${c.t}:` + c.points.map((x) => `${x.texte}@${x.t}`).join('|'));

console.log('1. References : en fin, en debut, entre parentheses, en plage');
{
  const r = (t) => JSON.stringify(separerRef(t));
  verifie('en fin', r('Un point important [1:23]') === '{"texte":"Un point important","t":83}', r('Un point important [1:23]'));
  verifie('en fin, point final apres', r('Un point important [1:23].') === '{"texte":"Un point important","t":83}');
  verifie('en debut', r('[1:23] Un point important') === '{"texte":"Un point important","t":83}');
  verifie('entre parentheses', r('Un point important (1:23)') === '{"texte":"Un point important","t":83}');
  verifie('plage : on garde son debut', r('Le défi [1:23 – 2:10]') === '{"texte":"Le défi","t":83}', r('Le défi [1:23 – 2:10]'));
  verifie('avec les heures', r('Fin du live [1:02:03]') === '{"texte":"Fin du live","t":3723}');
  verifie('timecode nu dans la phrase : il en fait partie',
    r('On en reparle à 3:45 avec l’invité [3:40]') === '{"texte":"On en reparle à 3:45 avec l’invité","t":220}', r('On en reparle à 3:45 avec l’invité [3:40]'));
  verifie('ligne sans reference', r('Juste une phrase') === '{"texte":"Juste une phrase","t":null}');
}

console.log('\n2. Chapitres : les mises en forme possibles de Gemini');
{
  const attendu = 'Intro@0:Le défi est lancé@12|Les règles@40;Nuit dehors@150:Ils dorment dehors@160';
  const s1 = structurer([h('En bref', 2), p('Une vidéo IRL.'), h('Chapitres', 2),
    h('Intro [0:00]'), li('Le défi est lancé [0:12]'), li('Les règles [0:40]'),
    h('Nuit dehors [2:30]'), li('Ils dorment dehors [2:40]')]);
  verifie('modele suivi (### titres, - points)', resume(s1).join(';') === attendu, resume(s1));
  verifie('« En bref » lu a part', s1 && s1.bref.join('') === 'Une vidéo IRL.');

  const s2 = structurer([h('Chapitres', 2), li('Intro [0:00]'), li('Le défi est lancé [0:12]', 1), li('Les règles [0:40]', 1),
    li('Nuit dehors [2:30]'), li('Ils dorment dehors [2:40]', 1)]);
  verifie('chapitres en puces, points en sous-puces', resume(s2).join(';') === attendu, resume(s2));

  const s3 = structurer([h('Chapitres', 2), p('Intro [0:00]'), li('Le défi est lancé [0:12]'), li('Les règles [0:40]'),
    p('Nuit dehors [2:30]'), li('Ils dorment dehors [2:40]')]);
  verifie('titres en paragraphes (gras partiel), points en puces', resume(s3).join(';') === attendu, resume(s3));

  const s4 = structurer([h('Intro [0:00]', 2), li('Le défi est lancé [0:12]'), li('Les règles [0:40]'),
    h('Nuit dehors [2:30]', 2), li('Ils dorment dehors [2:40]')]);
  verifie('sans titre « Chapitres », titres horodates', resume(s4).join(';') === attendu, resume(s4));

  const s5 = structurer([h('Chapitres', 2), h('[0:00] Intro'), li('[0:12] Le défi est lancé'), li('[0:40] Les règles'),
    h('[2:30] Nuit dehors'), li('[2:40] Ils dorment dehors')]);
  verifie('timecodes places en debut de ligne malgre la consigne', resume(s5).join(';') === attendu, resume(s5));

  const s6 = structurer([h('Chapitres', 2), h('Intro [0:00]'), li('Le défi est lancé [0:12]'),
    h('À retenir', 2), li('Une idée clé [1:00]')]);
  verifie('« ## À retenir » n’est pas un chapitre', s6 && s6.chapitres.length === 1 && s6.autres.length === 2, resume(s6));

  const s7 = structurer([h('En bref', 2), p('Résumé.'), h('Déroulé', 2), li('[0:00] Début'), li('[0:30] Milieu')]);
  verifie('ancien format (liste de moments) : pas de chapitres, affiche tel quel', s7 === null);
}

console.log('\n3. References oubliees : retrouvees, et marquees comme telles');
{
  const s = structurer([h('Chapitres', 2), h('La recharge'), li('La recharge rapide prend trente minutes [0:50]'),
    li('La batterie lithium tient quatre cents kilomètres')]);
  const rows = [
    { start: 0, text: 'bonjour on teste une voiture électrique' },
    { start: 25, text: 'la batterie lithium tient environ quatre cents kilomètres' },
    { start: 50, text: 'la recharge rapide sur borne prend trente minutes' }
  ];
  completerRefs(s, rows);
  const c = s.chapitres[0];
  verifie('chapitre sans timecode : celui de son premier point donne', c.t === 50 && c.estime === true, c);
  verifie('point sans timecode : retrouve dans la transcription', c.points[1].t === 25 && c.points[1].estime === true, c.points[1]);
  verifie('point qui avait sa reference : intact', c.points[0].t === 50 && !c.points[0].estime);
}

console.log('\n4. Avis des commentaires : pourcentages ou qu’ils soient');
{
  const r1 = structurerAvis([h('Avis', 2), p('Positifs : 82 %'), p('Négatifs : 18 %'),
    h('Ce qui plaît', 2), li('Le concept'), h('Ce qui déplaît', 2), li('Le son'), h('Ce que les gens demandent', 2), li('Une suite')]);
  verifie('format attendu', r1 && r1.pos === 82 && r1.neg === 18 && r1.plait.join() === 'Le concept'
    && r1.deplait.join() === 'Le son' && r1.demandes.join() === 'Une suite', r1);

  const r2 = structurerAvis([h('Avis : 85 % positifs, 15 % négatifs', 2), h('Ce qui plaît', 2), li('Le duo')]);
  verifie('pourcentages dans le titre', r2 && r2.pos === 85 && r2.neg === 15 && r2.plait.join() === 'Le duo', r2);

  const r3 = structurerAvis([h('Avis', 2), li('Positifs : 90 %'), h('Ce qui plaît', 2), li('Tout')]);
  verifie('un seul pourcentage donne : l’autre en est deduit', r3 && r3.pos === 90 && r3.neg === 10, r3);

  const r4 = structurerAvis([h('En bref', 2), p('Le public a adoré.'), h('La majorité', 2), li('Veut une suite')]);
  verifie('ancien format : affiche tel quel', r4 === null);
}

console.log('\n5. Avis des commentaires : l’affichage');
{
  const rendre = (r) => { const d = window.document.createElement('div'); rendreAvis(d, r); return d; };
  const d1 = rendre(structurerAvis([h('Avis', 2), p('Positifs : 70 %'), p('Négatifs : 20 %'),
    h('Ce qui plaît', 2), li('Le concept'), h('Ce qui déplaît', 2), li('Aucune critique notable.'),
    h('Ce que les gens demandent', 2), li('Rien de notable.')]));
  const larg = (sel) => d1.querySelector(sel).style.width;
  verifie('70 / 20 ramene a 100 : 78 % et 22 %', larg('.yttools-cm-barre-pos') === '78%' && larg('.yttools-cm-barre-neg') === '22%',
    [larg('.yttools-cm-barre-pos'), larg('.yttools-cm-barre-neg')]);
  const neg = d1.querySelector('.yttools-cm-bloc.is-neg');
  verifie('« Aucune critique notable » : une mention, pas une puce', neg && !neg.querySelector('li')
    && neg.querySelector('.yttools-cm-vide').textContent === 'Aucune critique notable.');
  const ask = d1.querySelector('.yttools-cm-bloc.is-ask');
  verifie('« Rien de notable » : une mention, pas une puce', ask && !ask.querySelector('li') && /Rien de notable/.test(ask.textContent));

  const d2 = rendre({ pos: 0, neg: 0, plait: ['Des questions'], deplait: [], demandes: [], autres: [] });
  verifie('aucun avis tranche : pas de barre, une phrase', !d2.querySelector('.yttools-cm-barre') && /Pas d’avis tranché/.test(d2.textContent));

  const d3 = rendre(structurerAvis([h('Avis', 2), p('Positifs : 100 %'), p('Négatifs : 0 %'), h('Ce qui plaît', 2), li('Tout')]));
  verifie('100 % positifs : barre toute verte', d3.querySelector('.yttools-cm-barre-pos').style.width === '100%'
    && d3.querySelector('.yttools-cm-barre-neg').style.width === '0%');
  verifie('jamais de HTML venu de Gemini', !rendre(structurerAvis([h('Ce qui plaît', 2), li('<img src=x onerror=alert(1)>')])).querySelector('img'));
}

console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
process.exit(echecs ? 1 : 0);
