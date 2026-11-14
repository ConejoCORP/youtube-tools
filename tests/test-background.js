/*
 * Service worker (background.js) avec un faux objet chrome : ouverture de la
 * fenetre Gemini, attente du chargement, injection, dialogue par le port,
 * fermeture et retour a YouTube.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync(EXT + 'background.js', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

/** urlChargee : ce que tabs.get renvoie une fois charge (null = page de connexion). */
function monde({ urlChargee = 'https://gemini.google.com/app' } = {}) {
  const journal = [];
  const onMessage = [];
  const onConnect = new Set();
  const demarrage = [];
  const badge = { texte: null };
  const reseau = [];
  const GEMINI_TAB = 77;

  const chrome = {
    runtime: {
      onMessage: { addListener: (fn) => onMessage.push(fn) },
      onConnect: { addListener: (fn) => onConnect.add(fn), removeListener: (fn) => onConnect.delete(fn) },
      onStartup: { addListener: (fn) => demarrage.push(fn) },
      onInstalled: { addListener: (fn) => demarrage.push(fn) },
      getManifest: () => ({ version: '3.8.0' })
    },
    management: { getSelf: async () => ({ installType: 'development' }) },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    action: {
      setBadgeText: async (o) => { badge.texte = o.text; },
      setBadgeBackgroundColor: async () => {}
    },
    windows: {
      get: async (id) => ({ id, left: 0, top: 0, width: 1600, height: 900 }),
      getLastFocused: async () => ({ id: 1, left: 0, top: 0, width: 1600, height: 900 }),
      create: async (opts) => { journal.push(['create', opts]); return { id: 9, tabs: [{ id: GEMINI_TAB }] }; },
      remove: async (id) => { journal.push(['remove', id]); },
      update: async (id, o) => { journal.push(['update', id, o]); }
    },
    tabs: {
      get: async () => ({ status: 'complete', url: urlChargee || undefined }),
      query: async () => [{ id: GEMINI_TAB }]
    },
    scripting: {
      executeScript: async (o) => { journal.push(['inject', o.target.tabId, o.files]); return [{}]; }
    }
  };

  const ctx = { chrome, setTimeout, clearTimeout, console, Date, JSON,
    fetch: async (url, o) => { reseau.push({ url, o }); return { ok: true, json: async () => ({ version: '3.9.0', ref: 'abc', files: ['manifest.json'] }) }; } };
  ctx.self = ctx;
  ctx.importScripts = (f) => vm.runInContext(fs.readFileSync(EXT + f, 'utf8'), ctx);
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);

  /** Simule le pilote injecte : il ouvre un port depuis l'onglet donne. */
  function connecter(tabId) {
    const port = {
      name: 'yttools-gemini',
      sender: { tab: { id: tabId } },
      recus: [],
      ecouteurs: [],
      fermeture: [],
      postMessage(m) { this.recus.push(m); },
      onMessage: { addListener(fn) { port.ecouteurs.push(fn); } },
      onDisconnect: { addListener(fn) { port.fermeture.push(fn); } },
      disconnect() { port.ferme = true; },
      repondre(m) { port.ecouteurs.forEach((fn) => fn(m)); },
      couper() { port.fermeture.forEach((fn) => fn()); }
    };
    onConnect.forEach((fn) => fn(port));
    return port;
  }

  function demander(prompt) {
    return new Promise((resolve) => {
      const garde = onMessage[0]({ type: 'YTTOOLS_SUMMARIZE', prompt }, { tab: { id: 5, windowId: 1 } }, resolve);
      verifie('la reponse est annoncee comme asynchrone', garde === true);
    });
  }

  return { journal, connecter, demander, GEMINI_TAB, ecoutes: () => onConnect.size, demarrage, badge, reseau };
}

(async () => {
  console.log('0. Pastille de mise a jour');
  {
    const m = monde();
    verifie('aucune requete tant que le navigateur ne demarre pas', m.reseau.length === 0);
    verifie('ecoute demarrage et installation', m.demarrage.length === 2);
    m.demarrage[0]();
    await new Promise((r) => setTimeout(r, 50));
    verifie('pastille MAJ quand GitHub annonce 3.9.0', m.badge.texte === 'MAJ', m.badge.texte);
    verifie('une seule requete, vers GitHub, sans cookie',
      m.reseau.length === 1 && m.reseau[0].url.startsWith('https://raw.githubusercontent.com/StundZow/youtube-tools/main/version.json')
      && m.reseau[0].o.credentials === 'omit', m.reseau);
  }

  console.log('\n1. Deroulement normal');
  {
    const m = monde();
    const reponse = m.demander('Résume.');
    await sleep(50);

    const creation = m.journal.find((e) => e[0] === 'create');
    verifie('fenetre Gemini ouverte', creation && creation[1].url === 'https://gemini.google.com/app', creation);
    verifie('petite fenetre au premier plan', creation && creation[1].type === 'popup' && creation[1].focused === true);
    verifie('pilote injecte dans l’onglet Gemini',
      m.journal.some((e) => e[0] === 'inject' && e[1] === m.GEMINI_TAB && e[2][0] === 'gemini-writer.js'));

    // Un port venu d'un AUTRE onglet ne doit rien declencher.
    const intrus = m.connecter(123);
    verifie('port d’un autre onglet ignore', intrus.recus.length === 0);

    const port = m.connecter(m.GEMINI_TAB);
    verifie('« start » envoye avec le prompt', port.recus[0] && port.recus[0].type === 'start' && port.recus[0].prompt === 'Résume.');
    port.repondre({ type: 'done', blocks: [{ type: 'h', text: 'En bref' }] });

    const r = await reponse;
    await sleep(20);
    verifie('blocs rendus a YouTube', r.ok === true && r.blocks.length === 1, r);
    verifie('fenetre Gemini refermee', m.journal.some((e) => e[0] === 'remove' && e[1] === 9));
    verifie('la main revient a la fenetre YouTube',
      m.journal.some((e) => e[0] === 'update' && e[1] === 1 && e[2].focused === true));
    verifie('ecouteur de port nettoye', m.ecoutes() === 0, m.ecoutes());
  }

  console.log('\n2. Gemini demande une connexion');
  {
    const m = monde({ urlChargee: null });
    const r = await m.demander('Résume.');
    verifie('erreur « login »', r.ok === false && r.error === 'login', r);
    verifie('fenetre laissee ouverte pour se connecter', !m.journal.some((e) => e[0] === 'remove'));
    verifie('rien d’injecte', !m.journal.some((e) => e[0] === 'inject'));
  }

  console.log('\n3. Fenetre Gemini fermee en cours de route');
  {
    const m = monde();
    const reponse = m.demander('Résume.');
    await sleep(50);
    m.connecter(m.GEMINI_TAB).couper();
    const r = await reponse;
    verifie('erreur explicite', r.ok === false && /fermée/.test(r.error), r);
  }

  console.log('\n4. Erreur remontee par le pilote');
  {
    const m = monde();
    const reponse = m.demander('Résume.');
    await sleep(50);
    m.connecter(m.GEMINI_TAB).repondre({ type: 'error', error: 'Gemini met trop de temps à répondre.' });
    const r = await reponse;
    verifie('message transmis tel quel', r.ok === false && /trop de temps/.test(r.error), r);
    verifie('fenetre refermee', m.journal.some((e) => e[0] === 'remove'));
  }

  console.log('\n5. Les autres messages ne sont pas pour lui');
  {
    const m = monde();
    // On rejoue l'ecouteur avec un autre type de message.
    let appele = false;
    const src = SRC;
    const ecoute = [];
    vm.runInNewContext(src, {
      chrome: {
        runtime: { onMessage: { addListener: (fn) => ecoute.push(fn) }, onConnect: { addListener() {}, removeListener() {} },
          onStartup: { addListener() {} }, onInstalled: { addListener() {} } },
        windows: { create: async () => { appele = true; return { id: 1, tabs: [{ id: 1 }] }; } }
      },
      setTimeout, clearTimeout, console, importScripts: () => {}
    });
    const garde = ecoute[0]({ type: 'YTTOOLS_PING' }, {}, () => {});
    verifie('ignore, canal non retenu', garde === false && !appele);
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
