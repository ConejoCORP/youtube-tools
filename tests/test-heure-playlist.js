/*
 * YouTube : heure exacte de mise en ligne sous la video, et recherche dans une
 * playlist. Structures relevees sur les vraies pages (ytd-watch-info-text de
 * la page de lecture, ytd-playlist-video-list-renderer d'une playlist).
 */
const { EXT } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const lire = (f) => fs.readFileSync(EXT + f, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

function page(url, corps, scripts, reglages = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const dom = new JSDOM(`<!doctype html><html lang="fr"><head></head><body>${corps}</body></html>`, { url, runScripts: 'outside-only', virtualConsole: vc });
  const { window } = dom;
  let stocke = { ...reglages };
  const ecouteurs = [];
  window.chrome = {
    storage: {
      local: { get: async () => ({ yttoolsSettings: stocke }), set: async () => {} },
      onChanged: { addListener: (fn) => ecouteurs.push(fn) }
    }
  };
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const requetes = [];
  window.fetch = async (u) => { requetes.push(u); throw new Error('aucune requete attendue'); };
  for (const f of ['common.js', ...scripts]) window.eval(lire(f));
  const regle = (patch) => {
    const avant = stocke;
    stocke = { ...stocke, ...patch };
    ecouteurs.forEach((fn) => fn({ yttoolsSettings: { oldValue: avant, newValue: stocke } }, 'local'));
  };
  return { window, doc: window.document, regle, requetes };
}

const INFO = (date) => `
  <ytd-watch-metadata><ytd-watch-info-text id="ytd-watch-info-text" detailed><div id="info-container">
    <yt-formatted-string id="info"><span dir="auto">1 659 225&nbsp;vues</span><span dir="auto">  </span><span dir="auto">${date}</span></yt-formatted-string>
  </div></ytd-watch-info-text></ytd-watch-metadata>`;
const source = (doc, o) => doc.documentElement.setAttribute('data-yttools-rank-src', JSON.stringify({ id: 'lZGoJT4abos', ...o }));

(async () => {
  console.log('1. Heure exacte de mise en ligne (page de la vidéo)');
  {
    const p = page('https://www.youtube.com/watch?v=lZGoJT4abos', INFO('17 août 2026'), ['heure-video.js']);
    const pub = '2026-08-17T09:00:03-07:00';
    source(p.doc, { published: pub });
    await sleep(50);
    const s = p.doc.querySelector('#info .yttools-heure');
    const attendu = ' à ' + new Date(pub).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
    verifie('« 17 août 2026 à hh:mm », juste après la date', s && s.textContent === attendu && s.previousElementSibling.textContent === '17 août 2026', s && s.textContent);
    verifie('heure locale (18:00 à Paris pour 09:00 en Californie)', process.env.TZ !== 'Europe/Paris' || attendu === ' à 18:00');
    verifie('posée une seule fois', p.doc.querySelectorAll('.yttools-heure').length === 1);
    await sleep(1100);
    verifie('toujours une seule après la vérification périodique', p.doc.querySelectorAll('.yttools-heure').length === 1);

    p.regle({ watchTime: false });
    await sleep(30);
    verifie('réglage coupé : retirée', !p.doc.querySelector('.yttools-heure'));
    p.regle({ watchTime: true });
    await sleep(30);
    verifie('réglage rallumé : revenue', !!p.doc.querySelector('.yttools-heure'));

    source(p.doc, { id: 'autreVideo1', published: pub });
    await sleep(50);
    verifie('données d’une autre vidéo (navigation en cours) : rien', !p.doc.querySelector('.yttools-heure'));

    source(p.doc, { published: '2026-08-17' });
    await sleep(50);
    verifie('date sans heure : rien', !p.doc.querySelector('.yttools-heure'));
    verifie('aucune requête', p.requetes.length === 0);

    const q = page('https://www.youtube.com/watch?v=lZGoJT4abos', INFO('il y a 3 jours'), ['heure-video.js']);
    source(q.doc, { published: pub });
    await sleep(50);
    verifie('description fermée (« il y a 3 jours ») : rien', !q.doc.querySelector('.yttools-heure'));

    const r = page('https://www.youtube.com/watch?v=lZGoJT4abos', INFO('Première diffusion le 17 août 2026'), ['heure-video.js']);
    source(r.doc, { published: pub });
    await sleep(50);
    verifie('« Première diffusion le 17 août 2026 à hh:mm »', r.doc.querySelector('.yttools-heure')?.previousElementSibling.textContent === 'Première diffusion le 17 août 2026');

    const v = page('https://www.youtube.com/watch?v=lZGoJT4abos', INFO('17 août 2026').replace('1 659 225&nbsp;vues', '2025&nbsp;vues'), ['heure-video.js']);
    source(v.doc, { published: pub });
    await sleep(50);
    verifie('« 2025 vues » n’est pas pris pour une date', v.doc.querySelector('.yttools-heure')?.previousElementSibling.textContent === '17 août 2026');

    // Video recente (releve du 14 nov. 2026) : vues dans le compteur anime,
    // date en texte nu dans #info, sans <span>.
    const NU = `
      <ytd-watch-metadata><ytd-watch-info-text id="ytd-watch-info-text" detailed><div id="info-container">
        <div id="view-count" aria-label="67 822 vues"><yt-animated-rolling-number></yt-animated-rolling-number></div>
        <div id="date-text"></div>
        <yt-formatted-string id="info">14 nov. 2026</yt-formatted-string>
      </div></ytd-watch-info-text></ytd-watch-metadata>`;
    const nu = page('https://www.youtube.com/watch?v=lZGoJT4abos', NU, ['heure-video.js']);
    source(nu.doc, { published: '2026-11-14T04:30:25-08:00' });
    await sleep(50);
    const infoNu = nu.doc.querySelector('#info');
    const hNu = new Date('2026-11-14T04:30:25-08:00').toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' });
    verifie('date en texte nu (vidéo récente) : « 14 nov. 2026 à hh:mm »', infoNu.textContent === `14 nov. 2026 à ${hNu}`, infoNu.textContent);
    await sleep(1100);
    verifie('… posée une seule fois, même après la vérification périodique', nu.doc.querySelectorAll('.yttools-heure').length === 1);

    const en = page('https://www.youtube.com/watch?v=lZGoJT4abos', INFO('Aug 17, 2026'), ['heure-video.js']);
    en.doc.documentElement.lang = 'en';
    source(en.doc, { published: pub });
    await sleep(50);
    verifie('YouTube en anglais : « at … »', /^ at /.test(en.doc.querySelector('.yttools-heure')?.textContent || ''));
  }

  console.log('\n2. Recherche dans une playlist');
  const VIDEO = (titre, chaine) => `<ytd-playlist-video-renderer><a id="video-title">${titre}</a><ytd-channel-name>${chaine}</ytd-channel-name></ytd-playlist-video-renderer>`;
  const PLAYLIST = `
    <ytd-browse page-subtype="playlist"><ytd-item-section-renderer>
      <div id="header"></div>
      <ytd-playlist-video-list-renderer><div id="contents">
        ${VIDEO('J’ai survécu 100 jours en Été', 'StundZow')}
        ${VIDEO('Minecraft mais tout est géant', 'StundZow')}
        ${VIDEO('Le meilleur évènement', 'Autre Chaîne')}
        <ytd-continuation-item-renderer></ytd-continuation-item-renderer>
      </div></ytd-playlist-video-list-renderer>
    </ytd-item-section-renderer></ytd-browse>`;
  {
    const p = page('https://www.youtube.com/playlist?list=PL123', PLAYLIST, ['playlist-recherche.js']);
    await sleep(50);
    const boite = p.doc.getElementById('yttools-pl-recherche');
    verifie('champ en tête de la liste', boite && boite.parentElement.tagName === 'YTD-PLAYLIST-VIDEO-LIST-RENDERER' && boite === boite.parentElement.firstElementChild);
    const input = boite.querySelector('input');
    const taper = (t) => { input.value = t; input.dispatchEvent(new p.window.Event('input')); };
    const visibles = () => [...p.doc.querySelectorAll('ytd-playlist-video-renderer')].filter((v) => !v.classList.contains('yttools-pl-cache')).map((v) => v.querySelector('#video-title').textContent);
    const compte = () => boite.querySelector('.yttools-pl-compte').textContent;

    taper('ete');
    verifie('sans accents ni majuscules : « ete » trouve « Été »', JSON.stringify(visibles()) === JSON.stringify(['J’ai survécu 100 jours en Été']), visibles());
    verifie('playlist incomplète : YouTube charge la suite', p.doc.documentElement.classList.contains('yttools-pl-tout-charger') && compte() === 'Chargement de toute la playlist…');
    taper('stundzow minecraft');
    verifie('plusieurs mots, titre + chaîne', JSON.stringify(visibles()) === JSON.stringify(['Minecraft mais tout est géant']), visibles());

    // YouTube ajoute le dernier lot et retire son repere de chargement.
    const contents = p.doc.querySelector('#contents');
    contents.querySelector('ytd-continuation-item-renderer').remove();
    contents.insertAdjacentHTML('beforeend', VIDEO('Minecraft hardcore', 'StundZow'));
    await sleep(50);
    verifie('nouveau lot filtré aussi', JSON.stringify(visibles()) === JSON.stringify(['Minecraft mais tout est géant', 'Minecraft hardcore']), visibles());
    verifie('tout chargé : compteur « 2 vidéos »', compte() === '2 vidéos' && !p.doc.documentElement.classList.contains('yttools-pl-tout-charger'), compte());
    taper('zzz');
    verifie('« Aucune vidéo ne correspond »', compte() === 'Aucune vidéo ne correspond' && visibles().length === 0);

    input.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    verifie('Échap vide le champ et réaffiche tout', input.value === '' && visibles().length === 4 && compte() === '');

    taper('minecraft');
    p.doc.querySelector('#header').insertAdjacentHTML('beforeend', '<yt-sort-filter-sub-menu-renderer>Trier</yt-sort-filter-sub-menu-renderer>');
    await sleep(50);
    verifie('boutons de tri arrivés : champ déplacé au-dessus, recherche gardée',
      p.doc.getElementById('yttools-pl-recherche').nextElementSibling === p.doc.querySelector('#header') && p.doc.querySelector('#yttools-pl-recherche input').value === 'minecraft' && visibles().length === 2);

    p.window.history.pushState({}, '', '/playlist?list=PL456');
    p.doc.dispatchEvent(new p.window.Event('yt-navigate-finish'));
    await sleep(50);
    verifie('autre playlist : champ vide, tout réaffiché', p.doc.querySelector('#yttools-pl-recherche input').value === '' && visibles().length === 4);

    p.regle({ playlistSearch: false });
    await sleep(30);
    verifie('réglage coupé : champ retiré', !p.doc.getElementById('yttools-pl-recherche'));

    p.window.history.pushState({}, '', '/watch?v=abc');
    p.regle({ playlistSearch: true });
    await sleep(30);
    verifie('hors d’une page de playlist : rien', !p.doc.getElementById('yttools-pl-recherche'));
    verifie('aucune requête de notre part', p.requetes.length === 0);
  }

  console.log('\n3. Recherche dans une playlist : nouvelle mise en page (yt-lockup-view-model)');
  // Releve sur la playlist « Videos » d'une chaine, novembre 2026.
  const LOCKUP = (titre, chaine) => `<div><yt-lockup-view-model><div class="ytLockupViewModelHost">
      <a class="ytLockupViewModelContentImage"></a>
      <yt-lockup-metadata-view-model><div class="ytLockupMetadataViewModelTextContainer">
        <h3 class="ytLockupMetadataViewModelHeadingReset"><a class="ytLockupMetadataViewModelTitle"><span>${titre}</span></a></h3>
        <div class="ytLockupMetadataViewModelMetadata"><yt-content-metadata-view-model>
          <div class="ytContentMetadataViewModelMetadataRow"><span><a>${chaine}</a></span></div>
          <div class="ytContentMetadataViewModelMetadataRow"><span>1,2 M de vues</span><span>il y a 1 an</span></div>
        </yt-content-metadata-view-model></div>
      </div></yt-lockup-metadata-view-model></div></yt-lockup-view-model></div>`;
  const NOUVELLE = `
    <ytd-browse page-subtype="playlist"><yt-section-list-renderer><div><yt-item-section-renderer>
      <div id="header"><chip-bar-view-model>Tous Vidéos Shorts</chip-bar-view-model></div>
      <div id="contents">
        ${LOCKUP('1 Sourd 1 Aveugle cuisinent une bûche de Noël', 'StundZow')}
        ${LOCKUP('J’ai acheté 10 kg de cadeaux de Nöel perdus', 'StundZow')}
        ${LOCKUP('Minecraft mais tout est géant', 'StundZow')}
        <div><yt-continuation-item-view-model></yt-continuation-item-view-model></div>
      </div>
    </yt-item-section-renderer></div></yt-section-list-renderer></ytd-browse>`;
  {
    const p = page('https://www.youtube.com/playlist?list=UU123', NOUVELLE, ['playlist-recherche.js']);
    await sleep(50);
    const boite = p.doc.getElementById('yttools-pl-recherche');
    verifie('champ au-dessus des boutons Tous / Vidéos / Shorts', boite && boite.nextElementSibling === p.doc.querySelector('#header'));
    const input = boite.querySelector('input');
    input.value = 'noel';
    input.dispatchEvent(new p.window.Event('input'));
    const blocs = [...p.doc.querySelectorAll('#contents > div')].filter((d) => d.querySelector('yt-lockup-view-model'));
    const visibles = () => blocs.filter((d) => !d.classList.contains('yttools-pl-cache')).map((d) => d.querySelector('h3').textContent);
    verifie('« noel » trouve « Noël » et « Nöel », masque le reste (bloc entier)', JSON.stringify(visibles()) ===
      JSON.stringify(['1 Sourd 1 Aveugle cuisinent une bûche de Noël', 'J’ai acheté 10 kg de cadeaux de Nöel perdus']), visibles());
    verifie('les vues et la date ne comptent pas (« vues » ne trouve rien)', (() => {
      input.value = 'vues'; input.dispatchEvent(new p.window.Event('input')); return visibles().length === 0;
    })());
    verifie('suite de la playlist chargée par YouTube pendant la recherche', p.doc.documentElement.classList.contains('yttools-pl-tout-charger'));
    input.value = ''; input.dispatchEvent(new p.window.Event('input'));
    verifie('champ vidé : tout réaffiché, plus de chargement forcé', visibles().length === 3 && !p.doc.documentElement.classList.contains('yttools-pl-tout-charger'));
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
