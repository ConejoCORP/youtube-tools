/*
 * Mise a jour automatique : GitHub simule, dossier de l'extension simule en
 * memoire (API File System Access), IndexedDB remplace par un faux minimal.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const vm = require('vm');

const DIR = EXT;
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

/* ---------- dossier en memoire ---------- */
function dossier(fichiers, journal, bloques = []) {
  const d = {
    kind: 'directory', fichiers, sous: {}, perm: 'granted',
    async getFileHandle(nom, opts = {}) {
      if (!(nom in d.fichiers) && !opts.create) throw Object.assign(new Error('absent'), { name: 'NotFoundError' });
      return {
        getFile: async () => {
          if (!(nom in d.fichiers)) throw Object.assign(new Error('absent'), { name: 'NotFoundError' });
          return { text: async () => d.fichiers[nom], arrayBuffer: async () => new TextEncoder().encode(d.fichiers[nom]).buffer };
        },
        createWritable: async () => {
          let buf = '';
          return {
            write: async (data) => { buf = Buffer.from(data).toString('utf8'); },
            close: async () => {
              // Antivirus : l'ecriture est refusee au moment de fermer le fichier.
              if (bloques.includes(d.prefixe + nom)) throw Object.assign(new Error('virus'), { name: 'InvalidStateError' });
              d.fichiers[nom] = buf;
              journal.push(d.prefixe + nom);
            }
          };
        }
      };
    },
    async getDirectoryHandle(nom, opts = {}) {
      if (!d.sous[nom]) {
        if (!opts.create) throw new Error('absent');
        d.sous[nom] = dossier({}, journal, bloques);
        d.sous[nom].prefixe = d.prefixe + nom + '/';
      }
      return d.sous[nom];
    },
    async requestPermission() { return d.perm; }
  };
  d.prefixe = '';
  return d;
}

/* ---------- environnement ---------- */
function environnement({ installType = 'development', locale = '3.8.0', distant, pannes = [], sansPicker = false, brave = false }) {
  const storage = {};
  const requetes = [];
  const idb = {};
  const journal = [];
  let choix = null;
  let ouvertures = 0;

  const fetch = async (url, opts) => {
    requetes.push({ url, opts });
    if (pannes.some((p) => url.includes(p))) return { ok: false, status: 404 };
    if (url.includes('/main/version.json')) return { ok: true, json: async () => distant };
    const m = /\/youtube-tools\/([^/]+)\/youtube-tools\/(.+)$/.exec(url);
    if (!m) return { ok: false, status: 404 };
    if (m[2] === 'manifest.json') {
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ name: 'YouTube Tools', version: distant.version })).buffer };
    }
    return { ok: true, arrayBuffer: async () => new TextEncoder().encode(`contenu ${m[2]} @${m[1]}\nligne 2`).buffer };
  };

  const indexedDB = {
    open() {
      const req = {};
      const db = {
        createObjectStore() {},
        transaction() {
          return { objectStore: () => ({
            get(k) { const r = {}; setTimeout(() => { r.result = idb[k]; r.onsuccess && r.onsuccess(); }); return r; },
            put(v, k) { idb[k] = v; }
          }) };
        }
      };
      setTimeout(() => { req.result = db; req.onupgradeneeded && req.onupgradeneeded(); req.onsuccess && req.onsuccess(); });
      return req;
    }
  };

  const global = {
    fetch, indexedDB, TextEncoder, TextDecoder, Uint8Array, setTimeout, Date, JSON, Promise, Error, Array, String, Object, encodeURIComponent,
    chrome: {
      runtime: { getManifest: () => ({ version: locale }) },
      management: { getSelf: async () => ({ installType }) },
      storage: { local: {
        get: async (k) => ({ [k]: storage[k] }),
        set: async (o) => Object.assign(storage, o)
      } }
    },
    showDirectoryPicker: async () => { ouvertures++; if (!choix) throw Object.assign(new Error('annule'), { name: 'AbortError' }); return choix; }
  };
  if (sansPicker) delete global.showDirectoryPicker;
  global.navigator = brave ? { brave: { isBrave: async () => true } } : {};
  global.self = global;
  vm.createContext(global);
  vm.runInContext(fs.readFileSync(DIR + 'update-core.js', 'utf8'), global);
  return {
    U: global.__yttoolsUpdate, storage, requetes, journal,
    choisir: (d) => { choix = d; }, ouvertures: () => ouvertures
  };
}

const DISTANT = {
  version: '3.9.0', ref: 'abc1234', notes: 'Mise à jour auto',
  files: ['manifest.json', 'common.js', 'icons/icon16.png', '../../evil.js', '/etc/passwd']
};
const bonDossier = (journal, extra = {}, bloques = []) =>
  dossier({ 'manifest.json': JSON.stringify({ name: 'YouTube Tools', version: '3.8.0' }), ...extra }, journal, bloques);

(async () => {
  console.log('1. Comparaison de versions');
  {
    const { U } = environnement({ distant: DISTANT });
    verifie('3.10.0 > 3.9.0 (pas un tri alphabetique)', U.comparer('3.10.0', '3.9.0') === 1);
    verifie('3.8 == 3.8.0', U.comparer('3.8', '3.8.0') === 0);
    verifie('3.8.0 < 3.9.0', U.comparer('3.8.0', '3.9.0') === -1);
  }

  console.log('\n2. Verification aupres de GitHub');
  {
    const e = environnement({ distant: DISTANT });
    const r = await e.U.verifier();
    verifie('nouvelle version detectee', r && r.disponible && r.latest === '3.9.0', r);
    verifie('requete sans cookie ni cache', e.requetes[0].opts.credentials === 'omit' && e.requetes[0].opts.cache === 'no-store');
    verifie('uniquement raw.githubusercontent.com', e.requetes.every((q) => q.url.startsWith('https://raw.githubusercontent.com/ConejoCORP/youtube-tools/')));
    verifie('resultat memorise', e.storage.yttoolsUpdate && e.storage.yttoolsUpdate.latest === '3.9.0');

    const a = environnement({ distant: DISTANT, locale: '3.9.0' });
    verifie('deja a jour : rien a proposer', (await a.U.verifier()).disponible === false);

    const w = environnement({ distant: DISTANT, installType: 'normal' });
    verifie('install Chrome Web Store : aucune requete', (await w.U.verifier()) === null && w.requetes.length === 0);

    const h = environnement({ distant: DISTANT, pannes: ['version.json'] });
    verifie('GitHub injoignable : rien, sans erreur', (await h.U.verifier()) === null);
  }

  console.log('\n3. Installation');
  {
    const e = environnement({ distant: DISTANT });
    const info = await e.U.verifier();
    const etapes = [];

    // Mauvais dossier
    e.choisir(dossier({ 'manifest.json': JSON.stringify({ name: 'Autre extension' }) }, e.journal));
    let err = null;
    try { await e.U.installer(info, (t) => etapes.push(t)); } catch (x) { err = x; }
    verifie('mauvais dossier refuse', err && /pas celui de YouTube Tools/.test(err.message), err && err.message);
    verifie('… et rien n’y est ecrit', e.journal.length === 0, e.journal);

    // Bon dossier
    const d = bonDossier(e.journal);
    e.choisir(d);
    await e.U.installer(info, (t) => etapes.push(t));
    verifie('fichiers ecrits, sous-dossier icons/ cree',
      JSON.stringify([...e.journal].sort()) === JSON.stringify(['common.js', 'icons/icon16.png', 'manifest.json']), e.journal);
    verifie('manifest.json ecrit en DERNIER', e.journal[e.journal.length - 1] === 'manifest.json', e.journal);
    verifie('contenu pris au commit publie (ref)', d.fichiers['common.js'] === 'contenu common.js @abc1234\nligne 2', d.fichiers['common.js']);
    verifie('chemins dangereux ignores (.. et absolu)',
      !e.requetes.some((q) => /evil|passwd/.test(q.url)), e.requetes.map((q) => q.url));
    verifie('telechargements sans cookie', e.requetes.every((q) => q.opts.credentials === 'omit'));
    verifie('avancement affiche', etapes.some((t) => /Téléchargement 1\/3/.test(t)) && etapes.some((t) => /Installation 3\/3/.test(t)));

    // Deuxieme fois : le dossier est memorise, plus de fenetre de choix
    const avant = e.ouvertures();
    e.choisir(null);
    e.journal.length = 0;
    await e.U.installer(info, () => {});
    verifie('2e fois : dossier memorise, aucune fenetre de choix', e.ouvertures() === avant, e.ouvertures() - avant);
    verifie('2e fois : fichiers deja identiques, RIEN de reecrit', e.journal.length === 0, e.journal);
  }

  console.log('\n4. Coupure reseau en plein telechargement');
  {
    const e = environnement({ distant: DISTANT, pannes: ['icons/icon16.png'] });
    const info = await e.U.verifier();
    e.choisir(bonDossier(e.journal));
    let err = null;
    try { await e.U.installer(info, () => {}); } catch (x) { err = x; }
    verifie('echec signale', err && /icon16\.png introuvable/.test(err.message), err && err.message);
    verifie('AUCUN fichier modifie : l’extension reste coherente', e.journal.length === 0, e.journal);
  }

  console.log('\n5. Fenetre de choix annulee');
  {
    const e = environnement({ distant: DISTANT });
    const info = await e.U.verifier();
    let err = null;
    try { await e.U.installer(info, () => {}); } catch (x) { err = x; }
    verifie('annulation remontee comme AbortError', err && err.name === 'AbortError');
  }

  console.log('\n6. version.json pret pour la release');
  {
    const e = environnement({ distant: { ...DISTANT, files: ['common.js'] } });
    const info = await e.U.verifier();
    e.choisir(bonDossier(e.journal));
    let err = null;
    try { await e.U.installer(info, () => {}); } catch (x) { err = x; }
    verifie('liste sans manifest.json refusee', err && /invalide/.test(err.message));
  }

  console.log('\n7. Fichiers deja a jour, fins de ligne Windows');
  {
    const e = environnement({ distant: DISTANT });
    const info = await e.U.verifier();
    // Depot Git sous Windows : meme contenu, en CRLF.
    e.choisir(bonDossier(e.journal, { 'common.js': 'contenu common.js @abc1234\r\nligne 2' }));
    await e.U.installer(info, () => {});
    verifie('meme contenu en CRLF : pas reecrit', !e.journal.includes('common.js'), e.journal);
    verifie('les autres fichiers, eux, sont ecrits', e.journal.includes('icons/icon16.png') && e.journal.includes('manifest.json'), e.journal);
  }

  console.log('\n8. Un fichier bloque par l\'antivirus a l\'ecriture');
  {
    const e = environnement({ distant: { ...DISTANT, files: ['manifest.json', 'common.js', 'icons/icon16.png', 'update-page.js'] } });
    const info = await e.U.verifier();
    e.choisir(bonDossier(e.journal, {}, ['common.js']));
    let err = null;
    try { await e.U.installer(info, () => {}); } catch (x) { err = x; }
    verifie('echec signale, fichier nomme', err && /common\.js/.test(err.message) && /antivirus/.test(err.message), err && err.message);
    verifie('les fichiers suivants sont quand meme ecrits', e.journal.includes('icons/icon16.png') && e.journal.includes('update-page.js'), e.journal);
    verifie('manifest.json PAS ecrit : la version n\'est pas annoncee a tort', !e.journal.includes('manifest.json'), e.journal);
  }

  console.log('\n9. Dossier choisi dès l\'installation (page d\'accueil)');
  {
    const e = environnement({ distant: DISTANT });
    verifie('au départ : aucun dossier mémorisé', (await e.U.dossierMemorise()) === null);

    e.choisir(dossier({ 'manifest.json': JSON.stringify({ name: 'Autre extension' }) }, e.journal));
    let err = null;
    try { await e.U.choisirDossier(); } catch (x) { err = x; }
    verifie('mauvais dossier refusé, rien de mémorisé', err && /pas celui de YouTube Tools/.test(err.message) && (await e.U.dossierMemorise()) === null);

    const d = bonDossier(e.journal);
    d.name = 'youtube-tools';
    e.choisir(d);
    await e.U.choisirDossier();
    verifie('bon dossier : mémorisé, son nom affichable', (await e.U.dossierMemorise()) === 'youtube-tools');
    verifie('choisir le dossier n’écrit rien', e.journal.length === 0, e.journal);

    // Plus tard, la mise a jour : plus aucune fenetre de choix.
    const avant = e.ouvertures();
    e.choisir(null);
    const info = await e.U.verifier();
    await e.U.installer(info, () => {});
    verifie('mise à jour suivante : directement dans ce dossier, sans le redemander',
      e.ouvertures() === avant && e.journal.includes('manifest.json'), { fenetres: e.ouvertures() - avant, ecrits: e.journal });
  }

  console.log('\n10. Brave : acces aux dossiers bloque par defaut');
  {
    const e = environnement({ distant: DISTANT, sansPicker: true, brave: true });
    verifie('Brave sans le réglage : on le sait avant de cliquer', e.U.peutEcrire() === false && e.U.estBrave() === true);
    let err = null;
    try { await e.U.choisirDossier(); } catch (x) { err = x; }
    verifie('message qui dit quoi activer', err && err.name === 'SansAcces' && err.message.includes('brave://flags/#file-system-access-api'), err && err.message);
    const info = await e.U.verifier();
    err = null;
    try { await e.U.installer(info, () => {}); } catch (x) { err = x; }
    verifie('mise à jour : même explication, rien d’écrit', err && err.name === 'SansAcces' && e.journal.length === 0);

    const f = environnement({ distant: DISTANT, sansPicker: true });
    err = null;
    try { await f.U.choisirDossier(); } catch (x) { err = x; }
    verifie('autre navigateur sans accès : mise à jour à la main', err && /à la main/.test(err.message) && !/brave/i.test(err.message));

    const g = environnement({ distant: DISTANT, brave: true });
    verifie('Brave avec le réglage activé : accès normal', g.U.peutEcrire() === true);
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
