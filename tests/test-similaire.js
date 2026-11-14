/*
 * YouTube Studio : video similaire de plusieurs Shorts, et heure exacte de
 * publication au survol d'une date. Structures relevees sur le vrai Studio
 * (Contenu > Shorts, barre de selection, menu « Modifier »).
 *
 * Studio est simule : le selecteur de videos, ses requetes (pour le contexte)
 * et la reponse a l'enregistrement. Aucune requete ne part.
 */
const { EXT } = require('./_outils');
const fs = require('fs');
const { webcrypto } = require('crypto');
const { TextEncoder } = require('util');
const { JSDOM, VirtualConsole } = require('jsdom');

const lire = (f) => fs.readFileSync(EXT + f, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};
const CH = 'UCcXNrBbhJ2AwbtiPTzQCJ-A';
const SHORTS = [['aaaaaaaaaa1', 'Premier Short'], ['bbbbbbbbbb2', 'Deuxième Short'], ['ccccccccc3c', 'Troisième Short']];
const JETON = 'j'.repeat(172);

const ligne = ([id, titre], coche) => `
  <ytcp-video-row>
    <div class="tablecell-selection"><ytcp-checkbox-lit${coche ? ' checked' : ''}></ytcp-checkbox-lit></div>
    <a id="video-title" href="/video/${id}/edit">${titre}</a>
    <div class="tablecell-date">3 janv. 2026<div class="cell-description">Publiée</div></div>
  </ytcp-video-row>`;

const MENU = `
  <tp-yt-paper-listbox id="menu-modifier">
    <tp-yt-paper-item test-id="TITLE">Titre</tp-yt-paper-item>
    <tp-yt-paper-item test-id="DESCRIPTION">Description</tp-yt-paper-item>
    <tp-yt-paper-item test-id="TAGS">Tags</tp-yt-paper-item>
    <tp-yt-paper-item test-id="VISIBILITY">Visibilité</tp-yt-paper-item>
    <tp-yt-paper-item test-id="MONETIZATION">Monétisation</tp-yt-paper-item>
    <tp-yt-paper-item test-id="SEPARATOR"></tp-yt-paper-item>
    <tp-yt-paper-item test-id="AD_SETTINGS">Paramètres des annonces</tp-yt-paper-item>
  </tp-yt-paper-listbox>
  <tp-yt-paper-listbox id="autre-menu"><tp-yt-paper-item test-id="TITLE">Titre</tp-yt-paper-item></tp-yt-paper-listbox>`;

function page({ chemin = '/videos/short', coches = [0, 1], reglages = {}, reponse, selecteur = 'ok', sansMenu = false } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const html = `<!doctype html><html lang="fr"><head></head><body>
    <ytcp-video-bulk-actions><ytcp-bulk-actions>
      <div id="header" class="opened"><div class="label selection-label">${coches.length} vidéos sélectionnées</div>
        <span class="toolbar-wrapper">Modifier</span><div class="chain-edit-button-container"></div></div>
      <div id="editors"></div><div class="footer"></div>
    </ytcp-bulk-actions></ytcp-video-bulk-actions>
    ${sansMenu ? '' : MENU}
    ${SHORTS.map((s, i) => ligne(s, coches.includes(i))).join('')}
  </body></html>`;
  const dom = new JSDOM(html, { url: `https://studio.youtube.com/channel/${CH}${chemin}`, runScripts: 'outside-only', virtualConsole: vc });
  const { window } = dom;
  const doc = window.document;
  let stocke = { ...reglages };
  const ecouteurs = [];
  window.chrome = {
    storage: {
      local: { get: async () => ({ yttoolsSettings: stocke }), set: async () => {} },
      onChanged: { addListener: (fn) => ecouteurs.push(fn) }
    }
  };
  const regle = (patch) => {
    const avant = stocke;
    stocke = { ...stocke, ...patch };
    ecouteurs.forEach((fn) => fn({ yttoolsSettings: { oldValue: avant, newValue: stocke } }, 'local'));
  };
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true });
  window.TextEncoder = TextEncoder;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  doc.cookie = 'SAPISID=cle-de-test';
  window.ytcfg = { get: (k) => ({ INNERTUBE_API_KEY: 'CLE_API', SESSION_INDEX: 0, DELEGATED_SESSION_ID: '1234', CHANNEL_ID: CH })[k] };

  // Les requetes de Studio (XHR) : seul leur corps nous interesse.
  class FauxXHR { open() {} send() {} setRequestHeader() {} }
  window.XMLHttpRequest = FauxXHR;
  const studioEnvoie = (corps) => { const x = new window.XMLHttpRequest(); x.open('POST', '/youtubei/v1/creator/list_creator_playlists?alt=json'); x.send(JSON.stringify(corps)); };

  // Ce que l'extension envoie a Studio.
  const envois = [];
  window.fetch = async (url, init) => {
    envois.push({ url, init, corps: JSON.parse(init.body) });
    const r = typeof reponse === 'function' ? reponse(envois.length) : reponse;
    return r || { ok: true, status: 200, json: async () => ({ overallResult: { resultCode: 'UPDATE_SUCCESS' } }) };
  };

  // Le selecteur de videos de Studio.
  const ouverts = [];
  if (selecteur !== 'absent') {
    class Selecteur extends window.HTMLElement {
      open() {
        ouverts.push({ exclus: this.excludedVideoIds, titre: this.dialogTitle, chaine: this.channelId });
        if (selecteur === 'annule') { setTimeout(() => this.dispatchEvent(new window.CustomEvent('iron-overlay-closed')), 20); return; }
        studioEnvoie({ context: { client: { hl: 'fr' }, request: { sessionInfo: { token: JETON } } }, channelId: CH });
        setTimeout(() => {
          this.dispatchEvent(new window.CustomEvent('video-picked', { detail: { videoId: 'LONGUEvideo', videoTitle: 'Ma longue vidéo' } }));
          this.dispatchEvent(new window.CustomEvent('iron-overlay-closed'));
        }, 20);
      }
    }
    window.customElements.define('ytcp-video-pick-dialog', Selecteur);
  }

  for (const f of ['common.js', 'studio-heure.js', 'studio-similaire.js', 'studio-page.js']) window.eval(lire(f));
  const clic = (n) => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return { window, doc, envois, ouverts, regle, clic, studioEnvoie };
}

const attendre = async (cond, ms = 3000) => { const fin = Date.now() + ms; while (!cond() && Date.now() < fin) await sleep(30); return cond(); };

(async () => {
  console.log('1. Entree « Vidéo similaire » dans le menu Modifier');
  {
    const p = page();
    await sleep(80);
    const entree = p.doc.querySelector('#menu-modifier .yttools-sim-entree');
    verifie('ajoutee au menu Modifier, juste après Monétisation',
      entree && entree.previousElementSibling.getAttribute('test-id') === 'MONETIZATION' && entree.textContent === 'Vidéo similaire');
    verifie('pas dans un autre menu (sans Description)', !p.doc.querySelector('#autre-menu .yttools-sim-entree'));
    verifie('classe html.yttools-similaire posée', p.doc.documentElement.classList.contains('yttools-similaire'));

    const q = page({ chemin: '/videos/upload' });
    await sleep(80);
    verifie('onglet Vidéos : rien', !q.doc.querySelector('.yttools-sim-entree') && !q.doc.documentElement.classList.contains('yttools-similaire'));

    const r = page({ reglages: { shortsRelated: false } });
    await sleep(80);
    verifie('réglage coupé : rien', !r.doc.querySelector('.yttools-sim-entree'));
    r.regle({ shortsRelated: true });
    await sleep(80);
    verifie('réglage rallumé : l’entrée revient', !!r.doc.querySelector('.yttools-sim-entree'));
  }

  console.log('\n2. Définir la vidéo similaire de 2 Shorts');
  {
    const p = page();
    await sleep(80);
    p.clic(p.doc.querySelector('.yttools-sim-entree'));
    const ed = p.doc.getElementById('yttools-sim-editeur');
    const appliquer = () => p.doc.querySelector('#yttools-sim-actions [data-role="appliquer"]');
    verifie('éditeur ouvert dans la barre de Studio', ed && ed.parentElement.id === 'editors');
    verifie('menus de Studio masqués pendant l’édition', p.doc.querySelector('ytcp-bulk-actions').classList.contains('yttools-sim-edition'));
    verifie('« Appliquer » grisé tant qu’aucune vidéo n’est choisie', appliquer() && appliquer().disabled);

    p.clic(p.doc.querySelector('.yttools-sim-video'));
    await attendre(() => p.doc.querySelector('.yttools-sim-texte'));
    verifie('sélecteur de Studio ouvert, sans les Shorts cochés',
      p.ouverts.length === 1 && JSON.stringify(p.ouverts[0].exclus) === JSON.stringify(['aaaaaaaaaa1', 'bbbbbbbbbb2']) && p.ouverts[0].chaine === CH, p.ouverts);
    verifie('vidéo choisie affichée', p.doc.querySelector('.yttools-sim-texte').textContent === 'Ma longue vidéo');
    verifie('« Appliquer » actif', !appliquer().disabled);

    p.clic(appliquer());
    const voile = p.doc.getElementById('yttools-sim-voile');
    verifie('confirmation demandée avant tout envoi', voile && p.envois.length === 0);
    verifie('confirmation : 2 Shorts listés', voile && voile.querySelectorAll('li').length === 2 && /2 Shorts/.test(voile.querySelector('h2').textContent));

    p.clic(voile.querySelector('.yttools-sim-pied .yttools-sim-bleu'));
    await attendre(() => /mis à jour/.test(voile.querySelector('h2').textContent), 5000);
    verifie('2 Shorts mis à jour', voile.querySelector('h2').textContent === '2 Shorts mis à jour', voile.querySelector('h2').textContent);
    verifie('une demande par Short', p.envois.length === 2);
    const e = p.envois[0];
    verifie('adressée à Studio seulement (même origine)', p.envois.every((x) => x.url.startsWith('/youtubei/v1/video_manager/metadata_update?alt=json&key=CLE_API')));
    verifie('signée comme Studio (SAPISIDHASH horodaté)', /^SAPISIDHASH \d{10}_[0-9a-f]{40}$/.test(e.init.headers.authorization));
    verifie('en-têtes de Studio', e.init.headers['x-origin'] === 'https://studio.youtube.com' && e.init.headers['x-goog-authuser'] === '0' && e.init.headers['x-goog-pageid'] === '1234' && e.init.credentials === 'include');
    verifie('contexte de Studio repris tel quel', e.corps.context.request.sessionInfo.token === JETON);
    verifie('Short visé et vidéo similaire', e.corps.encryptedVideoId === 'aaaaaaaaaa1' && p.envois[1].corps.encryptedVideoId === 'bbbbbbbbbb2' &&
      JSON.stringify(e.corps.videoLinkageShortsAttribution) === JSON.stringify({ targetExternalVideoId: ['LONGUEvideo'] }));
    verifie('le Short non coché n’est pas touché', !p.envois.some((x) => x.corps.encryptedVideoId === 'ccccccccc3c'));
    verifie('chaque ligne cochée ✓', [...voile.querySelectorAll('li')].every((li) => li.dataset.etat === 'ok'));
    verifie('éditeur refermé après succès', !p.doc.getElementById('yttools-sim-editeur'));
    p.clic(voile.querySelector('.yttools-sim-pied .yttools-sim-bleu'));
    verifie('« Fermer » referme la confirmation', !p.doc.getElementById('yttools-sim-voile'));
  }

  console.log('\n3. Retirer la vidéo similaire');
  {
    const p = page({ coches: [2] });
    await sleep(80);
    p.studioEnvoie({ context: { request: { sessionInfo: { token: JETON } } } });   // Studio a parle en cochant
    p.clic(p.doc.querySelector('.yttools-sim-entree'));
    const select = p.doc.querySelector('.yttools-sim-select');
    select.value = 'retirer';
    select.dispatchEvent(new p.window.Event('change'));
    verifie('mode « Retirer » : plus de champ vidéo, « Appliquer » actif',
      !p.doc.querySelector('.yttools-sim-video') && !p.doc.querySelector('#yttools-sim-actions [data-role="appliquer"]').disabled);
    p.clic(p.doc.querySelector('#yttools-sim-actions [data-role="appliquer"]'));
    const voile = p.doc.getElementById('yttools-sim-voile');
    verifie('confirmation « Retirer … de 1 Short »', /Retirer la vidéo similaire de 1 Short \?/.test(voile.querySelector('h2').textContent));
    p.clic(voile.querySelector('.yttools-sim-bleu'));
    await attendre(() => p.envois.length === 1 && /mis à jour/.test(voile.querySelector('h2').textContent));
    verifie('liste vide envoyée', p.envois[0] && JSON.stringify(p.envois[0].corps.videoLinkageShortsAttribution) === '{"targetExternalVideoId":[]}');
  }

  console.log('\n4. Erreurs');
  {
    const p = page({ reponse: (n) => n === 2 ? { ok: false, status: 403, json: async () => ({}) } : null });
    await sleep(80);
    p.clic(p.doc.querySelector('.yttools-sim-entree'));
    p.clic(p.doc.querySelector('.yttools-sim-video'));
    await attendre(() => p.doc.querySelector('.yttools-sim-texte'));
    p.clic(p.doc.querySelector('#yttools-sim-actions [data-role="appliquer"]'));
    const voile = p.doc.getElementById('yttools-sim-voile');
    p.clic(voile.querySelector('.yttools-sim-bleu'));
    await attendre(() => / non$/.test(voile.querySelector('h2').textContent), 5000);
    verifie('un refus : « 1 Short mis à jour, 1 non »', voile.querySelector('h2').textContent === '1 Short mis à jour, 1 non', voile.querySelector('h2').textContent);
    verifie('raison affichée (erreur 403)', /erreur 403/.test(voile.querySelector('.yttools-sim-info').textContent));
    verifie('ligne en échec marquée', voile.querySelectorAll('li')[1].dataset.etat === 'erreur');
    verifie('éditeur gardé pour réessayer', !!p.doc.getElementById('yttools-sim-editeur'));

    const q = page({ coches: [0], selecteur: 'absent' });
    await sleep(80);
    q.clic(q.doc.querySelector('.yttools-sim-entree'));
    q.clic(q.doc.querySelector('.yttools-sim-video'));
    await attendre(() => q.doc.querySelector('.yttools-sim-saisie'), 3000);
    const saisie = q.doc.querySelector('.yttools-sim-saisie');
    verifie('sélecteur indisponible : champ pour coller le lien', !!saisie);
    saisie.value = 'https://www.youtube.com/watch?v=LONGUEvideo&t=12';
    saisie.dispatchEvent(new q.window.Event('input'));
    verifie('lien reconnu, « Appliquer » actif', !q.doc.querySelector('#yttools-sim-actions [data-role="appliquer"]').disabled);
    // Aucun echange avec Studio depuis l'ouverture de la page : pas de contexte.
    q.clic(q.doc.querySelector('#yttools-sim-actions [data-role="appliquer"]'));
    const v2 = q.doc.getElementById('yttools-sim-voile');
    q.clic(v2.querySelector('.yttools-sim-bleu'));
    await attendre(() => /Aucun/.test(v2.querySelector('h2').textContent), 7000);
    verifie('sans contexte de Studio : rien d’envoyé, explication', q.envois.length === 0 && /coche ou décoche un Short/.test(v2.querySelector('.yttools-sim-info').textContent),
      v2.querySelector('.yttools-sim-info').textContent);

    const S = q.window.__yttoolsSimilaire;
    verifie('liens reconnus : youtu.be, shorts, /video/, ID seul',
      S.idDepuis('https://youtu.be/LONGUEvideo') === 'LONGUEvideo' && S.idDepuis('youtube.com/shorts/LONGUEvideo?x') === 'LONGUEvideo' &&
      S.idDepuis('https://studio.youtube.com/video/LONGUEvideo/edit') === 'LONGUEvideo' && S.idDepuis('LONGUEvideo') === 'LONGUEvideo' &&
      S.idDepuis('https://www.youtube.com/') === null);
  }

  console.log('\n5. Sélecteur fermé sans choix');
  {
    const p = page({ selecteur: 'annule' });
    await sleep(80);
    p.clic(p.doc.querySelector('.yttools-sim-entree'));
    p.clic(p.doc.querySelector('.yttools-sim-video'));
    await sleep(300);
    verifie('rien de choisi, pas de champ de secours', !p.doc.querySelector('.yttools-sim-texte') && !p.doc.querySelector('.yttools-sim-saisie') &&
      p.doc.querySelector('#yttools-sim-actions [data-role="appliquer"]').disabled);
    p.clic(p.doc.querySelector('.yttools-sim-icone'));
    verifie('la corbeille referme l’éditeur et rend les menus de Studio', !p.doc.getElementById('yttools-sim-editeur') && !p.doc.querySelector('.yttools-sim-edition'));
  }

  console.log('\n6. Contexte : seulement sur Contenu > Shorts');
  {
    const p = page({ chemin: '/videos/upload' });
    await sleep(700);
    p.studioEnvoie({ context: { request: { sessionInfo: { token: JETON } } } });
    // On force l'envoi : sans contexte retenu, rien ne part (le delai d'attente est de 4 s).
    p.doc.documentElement.classList.add('yttools-similaire');
    p.doc.dispatchEvent(new p.window.CustomEvent('yttools-similaire-appliquer', { detail: JSON.stringify({ ticket: 't', ids: ['aaaaaaaaaa1'], cible: '' }) }));
    await sleep(4400);
    verifie('requêtes de Studio ignorées hors de l’onglet Shorts', p.envois.length === 0);
  }

  console.log('\n7. Heure exacte au survol (page Contenu)');
  {
    const p = page({ chemin: '/videos/upload', sansMenu: true });
    const rows = p.doc.querySelectorAll('ytcp-video-row');
    rows[0].video = { videoId: 'aaaaaaaaaa1', timePublishedSeconds: '1767434069', timeCreatedSeconds: '1767434035' };
    rows[1].video = { videoId: 'bbbbbbbbbb2', timePublishedSeconds: '0', timeCreatedSeconds: '1767434035' };
    rows[1].querySelector('.cell-description').textContent = 'Importée';
    rows[2].video = { videoId: 'ccccccccc3c', timePublishedSeconds: '0', timeCreatedSeconds: '1767434035' };
    rows[2].querySelector('.cell-description').textContent = 'Programmée';
    await sleep(1200);
    verifie('heures recopiées dans les lignes', rows[0].getAttribute('data-yttools-heure') === 'aaaaaaaaaa1 1767434069 1767434035', rows[0].getAttribute('data-yttools-heure'));
    const H = p.window.__yttoolsHeureStudio;
    const attendu = 'Publiée le ' + H.formater(1767434069, 'fr');
    verifie('texte : « Publiée le samedi 3 janvier 2026 à hh:mm:ss »', H.texte(rows[0]) === attendu && /^Publiée le samedi 3 janvier 2026 à \d\d:\d\d:\d\d$/.test(attendu), attendu);
    verifie('vidéo importée : heure d’import', /^Importée le /.test(H.texte(rows[1]) || ''));
    verifie('vidéo programmée : rien', H.texte(rows[2]) === null);
    rows[0].querySelector('.tablecell-date').dispatchEvent(new p.window.MouseEvent('mouseover', { bubbles: true }));
    const bulle = p.doc.getElementById('yttools-heure-bulle');
    verifie('bulle au survol de la date', bulle && bulle.textContent === attendu);
    rows[0].querySelector('a').dispatchEvent(new p.window.MouseEvent('mouseover', { bubbles: true }));
    verifie('bulle retirée en quittant la date', !p.doc.getElementById('yttools-heure-bulle'));
    rows[0].querySelector('a').setAttribute('href', '/video/zzzzzzzzzzz/edit');
    verifie('ligne recyclée par Studio : pas d’heure d’une autre vidéo', H.texte(rows[0]) === null);
    p.regle({ publishTime: false });
    rows[1].querySelector('.tablecell-date').dispatchEvent(new p.window.MouseEvent('mouseover', { bubbles: true }));
    verifie('réglage coupé : pas de bulle', !p.doc.getElementById('yttools-heure-bulle') && !p.doc.documentElement.classList.contains('yttools-heure-studio'));
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
