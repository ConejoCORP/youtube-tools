/*
 * Verification du coeur de classement SANS aucune requete reseau.
 * Seules les fonctions pures sont exercees, avec des donnees fabriquees.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const C = require(EXT + 'rank-core.js');

let echecs = 0;
const verifie = (nom, obtenu, attendu) => {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + ' = ' + JSON.stringify(obtenu) +
    (ok ? '' : '   (attendu ' + JSON.stringify(attendu) + ')'));
};
const proche = (nom, obtenu, attendu, tol) => {
  const ok = Math.abs(obtenu - attendu) <= tol;
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + ' = ' + obtenu.toFixed(4) +
    (ok ? '' : '   (attendu ~' + attendu + ')'));
};

console.log('1. Lecture des nombres de vues (liste en anglais)');
verifie('1.2M views', C.parseViews('1.2M views'), 1200000);
verifie('12K views', C.parseViews('12K views'), 12000);
verifie('1,234 views', C.parseViews('1,234 views'), 1234);
verifie('No views', C.parseViews('No views'), 0);
verifie('texte sans nombre', C.parseViews('watching'), null);

console.log('\n2. Lecture des ages');
proche('3 days ago (milieu de tranche)', C.parseAgeHours('3 days ago'), 84, 0.01);
proche('Streamed 2 weeks ago', C.parseAgeHours('Streamed 2 weeks ago'), 420, 0.01);
proche('1 hour ago', C.parseAgeHours('1 hour ago'), 1.5, 0.01);
verifie('date absolue non reconnue', C.parseAgeHours('17 aout 2026'), null);

console.log('\n3. Courbe de croissance');
proche('moitie des vues a 2 jours', C.growth(48), 0.5, 0.001);
const g = C.growth;
verifie('croissante', g(24) < g(48) && g(48) < g(240), true);
verifie('bornee sous 1', g(100000) < 1, true);

console.log('\n4. Classement a age egal');
{
  const now = Date.now();
  const current = { id: 'cur', title: 'Actuelle', views: 1000, published: now - 48 * 3600e3 };
  const found = {
    target: { id: 'cur', title: 'Actuelle', views: 1000 },
    older: [
      // 10 jours, 5000 vues : a 2 jours elle en avait ~5000 * g(48)/g(252)
      { id: 'a', title: 'A', views: 5000, ageHours: 240, fetchedAt: now },
      // 2 jours, 800 vues : deja au meme age, donc inchangee
      { id: 'b', title: 'B', views: 800, ageHours: 48, fetchedAt: now }
    ]
  };
  const r = C.rank(current, found, 'video', now);
  verifie('statut', r.status, 'ok');
  verifie('total', r.total, 3);
  const parId = Object.fromEntries(r.entries.map((e) => [e.id, e]));
  verifie('la video actuelle n\'est pas estimee', parId.cur.estimated, false);
  verifie('les anciennes sont estimees', parId.a.estimated && parId.b.estimated, true);
  verifie('A ramenee sous ses 5000 vues brutes', parId.a.views < 5000, true);
  verifie('B inchangee (meme age)', Math.round(parId.b.views), 800);
  console.log('     classement :', r.entries.map((e) => e.id + '=' + Math.round(e.views)).join(' > '),
              '-> position', r.position);
}

console.log('\n5. Video trop recente');
{
  const now = Date.now();
  const r = C.rank({ id: 'x', views: 10, published: now - 3 * 3600e3 }, { target: {}, older: [] }, 'video', now);
  verifie('statut', r.status, 'too-early');
}

console.log('\n6. Shorts : pas d\'age dans la liste, on compare les vues brutes');
{
  const now = Date.now();
  const found = {
    target: { id: 'cur', title: 'S', views: 900 },
    older: [{ id: 'a', title: 'A', views: 5000, ageHours: null, fetchedAt: now }]
  };
  const r = C.rank({ id: 'cur', title: 'S', views: 900, published: now - 72 * 3600e3 }, found, 'short', now);
  const a = r.entries.find((e) => e.id === 'a');
  verifie('aucune estimation appliquee', a.estimated, false);
  verifie('vues brutes conservees', a.views, 5000);
}

console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe — aucune requete emise'));
process.exit(echecs ? 1 : 0);
