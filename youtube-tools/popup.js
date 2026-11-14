'use strict';

const KEY = 'yttools';
// Noms portes par l'extension avant « YouTube Tools », du plus recent au plus
// ancien : on relit ces cles pour ne pas perdre les champs deja saisis.
const OLD_KEYS = ['thumbview', 'prevyou'];

// Reglages des boutons injectes dans YouTube. Cle separee des champs d'apercu :
// les scripts de contenu ne lisent que celle-ci, et l'aperçu reste ponctuel.
const SETTINGS_KEY = 'yttoolsSettings';
const OLD_SETTINGS_KEYS = ['thumbviewSettings'];
const SETTINGS_DEFAULTS = {
  transcriptButton: true,
  videosButton: true,
  saveAsFile: false,
  rankBadge: true,
  captureButton: true,
  hideRevenue: false,
  viewsTrend: true,
  retentionZoom: true,
  studioTop10: true,
  watchTime: true,
  playlistSearch: true,
  publishTime: true,
  shortsRelated: true
};
let settings = { ...SETTINGS_DEFAULTS };

/*
 * Ecran Parametres : une case cliquable par reglage, rangees par site et par
 * section (presentation reprise de Better YouTube Studio). Le survol ou le
 * focus d'une case affiche son explication sous la grille.
 *
 * Icones Material Design (licence Apache 2.0).
 */
const REGLAGES = {
  youtube: [
    { section: 'Page de la vidéo' },
    { cle: 'transcriptButton', nom: 'Bouton transcription',
      icone: 'M14 17H4v2h10v-2zm6-8H4v2h16V9zM4 15h16v-2H4v2zM4 5v2h16V5H4z',
      aide: "Le bouton ☰ à côté du J'aime : copie la transcription en CSV, puis propose le résumé par Gemini." },
    { cle: 'captureButton', nom: "Bouton capture d'écran",
      icone: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
      aide: "Un appareil photo dans le lecteur : copie l'image affichée, à la résolution de la vidéo." },
    { cle: 'rankBadge', nom: 'Classement sur 10',
      icone: 'M7.5 21H2V9h5.5v12zm7.25-18h-5.5v18h5.5V3zM22 11h-5.5v10H22V11z',
      aide: 'Place de la vidéo parmi les 10 dernières de sa chaîne, à âge égal. Lit la liste publique de la chaîne, sans cookie, gardée 6 h.' },
    { cle: 'watchTime', nom: 'Heure de mise en ligne',
      icone: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
      aide: "Description ouverte, l'heure exacte s'ajoute après la date : « 17 août 2026 à 18:00 ». Aucune requête." },
    { section: 'Partout sur YouTube' },
    { cle: 'videosButton', nom: 'Export des vidéos',
      icone: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
      aide: 'Le bouton ⤓ en haut de page : copie en CSV toutes les vidéos chargées.' },
    { cle: 'playlistSearch', nom: 'Recherche dans les playlists',
      icone: 'M3 10h11v2H3zm0-4h11v2H3zm0 8h7v2H3zm17.59-1.42-3.17 3.17-1.41-1.42L15 17.34 17.41 19.75 22 15.17z',
      aide: "Un champ en haut d'une playlist pour la filtrer par titre ou par chaîne ; charge toute la playlist si besoin." },
    { cle: 'saveAsFile', nom: 'Enregistrer un fichier',
      icone: 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z',
      aide: 'La copie a toujours lieu. Activé, un fichier est téléchargé en plus : .csv pour les exports, .png pour une capture.' }
  ],
  studio: [
    { section: 'Général' },
    { cle: 'hideRevenue', nom: 'Masquer les revenus',
      icone: 'M12 7a5 5 0 0 1 4.64 6.83l2.92 2.92A11.8 11.8 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.74 2.74A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55A3 3 0 0 0 12.65 15l1.55 1.55A5 5 0 0 1 7.53 9.8zm4.31-.78 3.15 3.15.02-.16a3 3 0 0 0-3-3l-.17.01z',
      aide: "Floute chaque montant dans Studio ; un clic dessus l'affiche. Pour filmer ou partager ton écran." },
    { section: 'Tableau de bord et statistiques' },
    { cle: 'studioTop10', nom: 'Onglets Vidéos / Shorts',
      icone: 'M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h10v4h8v10z',
      aide: 'Tableau de bord : classement sur 10 séparé entre vidéos et Shorts, sur la carte de la dernière vidéo. Liste publique de la chaîne, sans cookie.' },
    { cle: 'retentionZoom', nom: 'Zoom sur la rétention',
      icone: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zm.5-7H9v2H7v1h2v2h1v-2h2V9h-2z',
      aide: 'Statistiques : molette sur le graphique de rétention pour zoomer, glisser pour se déplacer, double-clic pour revenir.' },
    { section: 'Page Contenu' },
    { cle: 'viewsTrend', nom: 'Flèches de tendance des vues',
      icone: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z',
      aide: "Page Contenu : chaque vidéo comparée aux 10 précédentes au même âge, d'après les chiffres affichés. Aucune requête." },
    { cle: 'publishTime', nom: 'Heure exacte au survol',
      icone: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
      aide: 'Page Contenu : survole une date pour voir le jour et l’heure exacts de publication. Aucune requête.' },
    { cle: 'shortsRelated', nom: 'Vidéo similaire en lot',
      icone: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z',
      aide: 'Contenu > Shorts : coche des Shorts, puis Modifier > Vidéo similaire. Seule fonction qui passe par ta session Studio ; rien n’est envoyé avant Appliquer.' }
  ]
};
const AIDE_PAR_DEFAUT = "Clique sur une case pour l'activer ou la couper. Survole-la pour voir ce qu'elle fait.";
let site = 'youtube';
const DEFAULTS = {
  channel: '',
  title: '',
  thumb: '',
  avatar: '',
  random: false,
  theme: 'light'
};

const $ = (id) => document.getElementById(id);
const el = {
  theme: $('theme'), reset: $('reset'),
  avatarBtn: $('avatarBtn'), avatarImg: $('avatarImg'), avatarFile: $('avatarFile'),
  channel: $('channel'),
  drop: $('drop'), thumbImg: $('thumbImg'), thumbFile: $('thumbFile'),
  clearThumb: $('clearThumb'), thumbInfo: $('thumbInfo'),
  title: $('videoTitle'), titleCount: $('titleCount'),
  random: $('randomPos'),
  preview: $('preview'), remove: $('remove'), status: $('status'),
  ouvrirReglages: $('ouvrirReglages'), retour: $('retour'),
  vueAccueil: $('vueAccueil'), vueReglages: $('vueReglages'),
  liste: $('reglagesListe'), aide: $('reglagesAide')
};

let state = { ...DEFAULTS };
// Un aperçu est affiché sur l'onglet YouTube courant. Jamais persisté : il ne
// vit que sur la page où on a cliqué, et disparaît dès qu'on navigue.
let live = false;

/* ------------------------------------------------------------------ state */

/** La premiere cle presente dans le stockage, en partant de la plus recente. */
function reprise(stored, keys) {
  for (const k of keys) if (stored[k]) return { valeur: stored[k], cle: k };
  return { valeur: null, cle: null };
}

async function load() {
  const toutes = [KEY, ...OLD_KEYS, SETTINGS_KEY, ...OLD_SETTINGS_KEYS];
  const stored = await chrome.storage.local.get(toutes);

  // Renommer l'extension ne doit pas faire perdre ce qui a deja ete saisi : on
  // reprend la plus recente des anciennes cles, puis on la supprime.
  const champs = reprise(stored, [KEY, ...OLD_KEYS]);
  state = { ...DEFAULTS, ...(champs.valeur || {}) };
  delete state.enabled;                       // résidu des anciennes versions

  const regl = reprise(stored, [SETTINGS_KEY, ...OLD_SETTINGS_KEYS]);
  settings = { ...SETTINGS_DEFAULTS, ...(regl.valeur || {}) };

  const perimees = [];
  if (champs.cle && champs.cle !== KEY) {
    await chrome.storage.local.set({ [KEY]: state });
    perimees.push(champs.cle);
  }
  if (regl.cle && regl.cle !== SETTINGS_KEY) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    perimees.push(regl.cle);
  }
  if (perimees.length) await chrome.storage.local.remove(perimees);

  render();
  live = await ping();
  render();
}

/** Les scripts de contenu suivent cette cle : ecrire suffit a tout mettre a jour. */
async function saveSettings(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  render();
}

/** L'onglet YouTube affiche-t-il un aperçu en ce moment ? */
async function ping() {
  const tab = await youtubeTab();
  if (!tab) return false;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'YTTOOLS_PING' });
    return !!(res && res.injected);
  } catch {
    return false;                             // content script pas encore chargé
  }
}

async function save(patch = {}) {
  state = { ...state, ...patch };
  await chrome.storage.local.set({ [KEY]: state });
}

function render() {
  document.documentElement.dataset.theme = state.theme;

  if (el.channel.value !== state.channel) el.channel.value = state.channel;
  if (el.title.value !== state.title) el.title.value = state.title;
  el.titleCount.textContent = state.title.length;

  el.random.setAttribute('aria-checked', String(!!state.random));

  el.liste.querySelectorAll('.tuile').forEach((t) => {
    const oui = String(!!settings[t.dataset.cle]);
    if (t.getAttribute('aria-checked') !== oui) t.setAttribute('aria-checked', oui);
  });

  setImg(el.thumbImg, state.thumb);
  el.drop.classList.toggle('filled', !!state.thumb);
  el.clearThumb.hidden = !state.thumb;

  setImg(el.avatarImg, state.avatar);

  el.remove.hidden = !live;
  el.preview.innerHTML = '';
  const eyes = document.createElement('span');
  eyes.className = 'eyes';
  eyes.textContent = '\u{1F440}';
  el.preview.append(eyes, ' ' + (live ? 'Mettre à jour l’aperçu' : 'Aperçu'));
}

function setImg(node, dataUrl) {
  if (dataUrl) { node.src = dataUrl; node.hidden = false; }
  else { node.removeAttribute('src'); node.hidden = true; }
}

function status(msg, kind = '') {
  el.status.textContent = msg;
  el.status.className = 'status ' + kind;
  if (msg) setTimeout(() => { if (el.status.textContent === msg) el.status.textContent = ''; }, 4000);
}

/* ------------------------------------------------------------------ images */

const MAX_W = { thumb: 1280, avatar: 144 };

function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Lecture du fichier impossible'));
    fr.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = src;
  });
}

/** Redimensionne dans un canvas -> dataURL compact (webp, repli jpeg). */
async function process(file, kind) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Ce fichier n’est pas une image');
  const raw = await readFile(file);
  const img = await loadImage(raw);

  const max = MAX_W[kind];
  const scale = Math.min(1, max / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  let out = canvas.toDataURL('image/webp', 0.9);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.92);

  // chrome.storage.local plafonne vers 10 Mo : on reste tres en dessous.
  let q = 0.8;
  while (out.length > 2500000 && q > 0.35) {
    out = canvas.toDataURL('image/webp', q);
    q -= 0.15;
  }

  return { dataUrl: out, w: img.naturalWidth, h: img.naturalHeight };
}

async function setThumb(file) {
  try {
    const { dataUrl, w, h } = await process(file, 'thumb');
    await save({ thumb: dataUrl });
    const off = Math.abs(w / h - 16 / 9) > 0.08;
    el.thumbInfo.textContent = w + '×' + h + (off ? ' — ratio ≠ 16:9, YouTube va rogner' : '');
    render();
  } catch (e) {
    status(e.message, 'err');
  }
}

async function setAvatar(file) {
  try {
    const { dataUrl } = await process(file, 'avatar');
    await save({ avatar: dataUrl });
    render();
  } catch (e) {
    status(e.message, 'err');
  }
}

/* ------------------------------------------------------------------ tab I/O */

async function youtubeTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && /^https:\/\/(www|m)\.youtube\.com\//.test(active.url || '')) return active;

  const [any] = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://m.youtube.com/*'] });
  return any || null;
}

/** Envoie un message, en injectant le content script s'il n'est pas encore la. */
async function send(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function apply() {
  if (!state.thumb && !state.title && !state.channel) {
    status('Ajoute au moins une miniature ou un titre', 'err');
    return;
  }

  const tab = await youtubeTab();
  if (!tab) {
    await chrome.tabs.create({ url: 'https://www.youtube.com/' });
    window.close();
    return;
  }

  try {
    const res = await send(tab.id, { type: 'YTTOOLS_APPLY', data: state });
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    if (res && res.ok) {
      live = true;
      window.close();
    } else {
      status('Aucune grille de vidéos trouvée sur cette page', 'err');
    }
  } catch {
    status('Recharge la page YouTube puis réessaie', 'err');
  }
}

async function removePreview() {
  live = false;
  render();
  const tab = await youtubeTab();
  if (tab) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'YTTOOLS_REMOVE' }); } catch { /* rien a retirer */ }
  }
  status('Aperçu retiré', 'ok');
}

/* ------------------------------------------------------------------ events */

el.theme.addEventListener('click', async () => {
  await save({ theme: state.theme === 'dark' ? 'light' : 'dark' });
  render();
});

el.reset.addEventListener('click', async () => {
  const theme = state.theme;
  state = { ...DEFAULTS, theme };
  await chrome.storage.local.set({ [KEY]: state });
  el.channel.value = '';
  el.title.value = '';
  el.thumbInfo.textContent = '';
  live = false;
  render();
  const tab = await youtubeTab();
  if (tab) {
    try { await chrome.tabs.sendMessage(tab.id, { type: 'YTTOOLS_REMOVE' }); } catch { /* noop */ }
  }
  status('Réinitialisé', 'ok');
});

el.channel.addEventListener('input', (e) => save({ channel: e.target.value }));
el.title.addEventListener('input', (e) => {
  el.titleCount.textContent = e.target.value.length;
  save({ title: e.target.value });
});

el.random.addEventListener('click', () => save({ random: !state.random }).then(render));

el.drop.addEventListener('click', () => el.thumbFile.click());
el.drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.thumbFile.click(); }
});
el.thumbFile.addEventListener('change', (e) => e.target.files[0] && setThumb(e.target.files[0]));

el.avatarBtn.addEventListener('click', () => el.avatarFile.click());
el.avatarFile.addEventListener('change', (e) => e.target.files[0] && setAvatar(e.target.files[0]));

el.clearThumb.addEventListener('click', async (e) => {
  e.stopPropagation();
  await save({ thumb: '' });
  el.thumbInfo.textContent = '';
  render();
});

['dragenter', 'dragover'].forEach((t) =>
  el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach((t) =>
  el.drop.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.remove('over'); })
);
el.drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) setThumb(file);
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData ? [...e.clipboardData.items] : [];
  const item = items.find((i) => i.type.startsWith('image/'));
  if (item) setThumb(item.getAsFile());
});

el.preview.addEventListener('click', () => apply());
el.remove.addEventListener('click', removePreview);

/* -------------------------------------------------------------- parametres */

function icone(d) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

const aide = (texte) => { el.aide.textContent = texte || AIDE_PAR_DEFAUT; };

/** Construit la grille du site choisi : un titre par section, une case par reglage. */
function construireReglages() {
  document.querySelectorAll('.site').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.site === site)));
  el.liste.textContent = '';
  let grille = null;
  for (const r of REGLAGES[site]) {
    if (r.section) {
      const titre = document.createElement('h3');
      titre.className = 'reglages-section';
      titre.textContent = r.section;
      grille = document.createElement('div');
      grille.className = 'reglages-grille';
      el.liste.append(titre, grille);
      continue;
    }
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'tuile';
    t.dataset.cle = r.cle;
    t.setAttribute('role', 'switch');
    t.setAttribute('aria-checked', String(!!settings[r.cle]));
    t.setAttribute('aria-description', r.aide);
    const nom = document.createElement('span');
    nom.className = 'tuile-nom';
    nom.textContent = r.nom;
    t.append(icone(r.icone), nom);
    t.addEventListener('click', () => saveSettings({ [r.cle]: !settings[r.cle] }));
    t.addEventListener('mouseenter', () => aide(r.aide));
    t.addEventListener('focus', () => aide(r.aide));
    t.addEventListener('mouseleave', () => aide());
    t.addEventListener('blur', () => aide());
    grille.append(t);
  }
  aide();
}

/** `clavier` : ouvert ou ferme au clavier, on deplace le focus pour ne pas le perdre. */
function afficherReglages(oui, clavier) {
  el.vueReglages.hidden = !oui;
  el.vueAccueil.hidden = oui;
  el.reset.hidden = oui;
  el.ouvrirReglages.setAttribute('aria-expanded', String(oui));
  if (oui) construireReglages();
  if (clavier) (oui ? el.retour : el.ouvrirReglages).focus();
}

// Un clic au clavier (Entree, Espace) a un `detail` nul ; un clic de souris, non.
el.ouvrirReglages.addEventListener('click', (e) => afficherReglages(el.vueReglages.hidden, e.detail === 0));
el.retour.addEventListener('click', (e) => afficherReglages(false, e.detail === 0));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.vueReglages.hidden) { e.preventDefault(); afficherReglages(false, true); }
});
document.querySelectorAll('.site').forEach((b) => b.addEventListener('click', () => {
  site = b.dataset.site;
  construireReglages();
}));

$('version').textContent = `Version ${chrome.runtime.getManifest().version}.`;

// Ouvert depuis YouTube Studio : l'onglet Studio est affiche d'emblee.
chrome.tabs.query({ active: true, currentWindow: true })
  .then(([t]) => { if (t && /^https:\/\/studio\.youtube\.com\//.test(t.url || '')) site = 'studio'; })
  .catch(() => {});

load();

/* ------------------------------------------------------------ mise a jour */

// Le dernier resultat connu s'affiche tout de suite, puis GitHub confirme.
function bandeauMaj(info) {
  const dispo = !!(info && info.disponible);
  $('maj').hidden = !dispo;
  if (dispo) $('majTexte').textContent = `Version ${info.latest} disponible`;
}

$('majBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('update.html') });
  window.close();
});

window.__yttoolsUpdate.dernierConnu().then(bandeauMaj);
window.__yttoolsUpdate.verifier().then((info) => {
  if (!info) return;                          // hors ligne : on garde l'etat connu
  bandeauMaj(info);
  chrome.action.setBadgeText({ text: info.disponible ? 'MAJ' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#7226ff' });
});
