'use strict';

/**
 * YouTube Studio — pont avec la page (monde MAIN).
 *
 * Les autres scripts Studio de l'extension vivent dans un monde isole : ils
 * voient le DOM, pas les proprietes JavaScript des elements de Studio. Ce
 * script-ci tourne dans la page et sert trois choses, chacune activee par une
 * classe que le monde isole pose sur <html> selon les reglages :
 *
 *  1. Heure exacte de publication (html.yttools-heure-studio)
 *     Recopie, pour chaque ligne de la page Contenu, l'heure de publication et
 *     d'import que Studio a deja chargees (ytcp-video-row.video) dans des
 *     attributs de la ligne. Aucune requete.
 *
 *  2. Choix d'une video (evenement yttools-similaire-choisir)
 *     Ouvre le selecteur de videos de Studio lui-meme (ytcp-video-pick-dialog).
 *     C'est Studio qui charge la liste, comme pour une seule video.
 *
 *  3. Video similaire de plusieurs Shorts (html.yttools-similaire)
 *     SEULE fonction de l'extension qui utilise la session de l'utilisateur,
 *     et seulement dans Contenu > Shorts :
 *       - pendant qu'on est sur cet onglet, on garde EN MEMOIRE, dans la page,
 *         le « contexte » que Studio joint a ses propres requetes (il contient
 *         un jeton de session indispensable pour enregistrer) ;
 *       - quand l'utilisateur clique « Appliquer » et confirme, on envoie a
 *         Studio, Short par Short, la meme demande que Studio envoie quand on
 *         change la video similaire d'un seul Short, signee comme Studio la
 *         signe (SAPISIDHASH, calcule a ce moment-la a partir du cookie).
 *     Rien n'est enregistre, rien ne sort de la page, rien n'est envoye
 *     ailleurs qu'a studio.youtube.com. Methode reprise de Better YouTube
 *     Studio (SQUIDUU), qui fait de meme.
 */

(() => {
  if (window.__yttoolsStudioPage) return;
  window.__yttoolsStudioPage = true;

  const racine = document.documentElement;
  const ID = /^[\w-]{11}$/;
  const envoyer = (nom, detail) =>
    document.dispatchEvent(new CustomEvent(nom, { detail: JSON.stringify(detail) }));
  const lire = (e) => { try { return JSON.parse(e.detail); } catch { return null; } };
  const cfg = (k) => { try { return window.ytcfg && window.ytcfg.get ? window.ytcfg.get(k) : undefined; } catch { return undefined; } };

  /* ------------------------------------------------ 1. heure de publication */

  function heures() {
    if (!racine.classList.contains('yttools-heure-studio')) return;
    for (const row of document.querySelectorAll('ytcp-video-row')) {
      let v = null;
      try { v = row.video || (row.polymerController && row.polymerController.video) || null; } catch { v = null; }
      if (!v || !v.videoId) continue;
      const val = [v.videoId, Number(v.timePublishedSeconds) || 0, Number(v.timeCreatedSeconds) || 0].join(' ');
      if (row.getAttribute('data-yttools-heure') !== val) row.setAttribute('data-yttools-heure', val);
    }
  }

  let prevu = false;
  new MutationObserver(() => {
    if (prevu) return;
    prevu = true;
    requestAnimationFrame(() => { prevu = false; heures(); });
  }).observe(racine, { childList: true, subtree: true });
  setInterval(heures, 1000);

  /* ---------------------------------------------- 2. selecteur de Studio */

  let selecteur = null;
  document.addEventListener('yttools-similaire-choisir', (e) => {
    const d = lire(e);
    if (!d || !d.ticket) return;
    const repondre = (r) => envoyer('yttools-similaire-choisi', { ticket: d.ticket, ...r });
    if (!customElements.get('ytcp-video-pick-dialog')) { repondre({ indisponible: true }); return; }

    if (selecteur) selecteur.remove();
    const dlg = document.createElement('ytcp-video-pick-dialog');
    selecteur = dlg;
    document.body.appendChild(dlg);
    // Les memes reglages que Studio pour la video similaire d'un Short :
    // videos traitees, hors privees, sans les Shorts selectionnes.
    const props = {
      channelId: (location.pathname.match(/\/channel\/(UC[\w-]{22})/) || [])[1] || cfg('CHANNEL_ID'),
      excludedVideoIds: (d.exclure || []).filter((x) => ID.test(x)),
      predefinedVideoFilters: [
        { or: { operands: [{ statusIs: { value: 'VIDEO_STATUS_PROCESSED' } }, { statusIs: { value: 'VIDEO_STATUS_UPLOADED' } }] } },
        { not: { operand: { privacyIs: { value: 'VIDEO_PRIVACY_PRIVATE' } } } }
      ],
      supportedPageSizes: [50],
      enablePagination: false,
      searchType: 'ANY',
      videoEligibilityCriteria: 'NONE',
      hideAnyQuery: true,
      allowMultipleSelect: false,
      enableRtoDeprecation: true,
      minWidth: 960,
      maxWidth: 960,
      dialogTitle: String(d.titre || ''),
      searchYourVideosInputPlaceholder: String(d.recherche || '')
    };
    for (const [k, v] of Object.entries(props)) {
      try { dlg[k] = v; } catch { /* propriete absente de cette version */ }
      try { if (dlg.polymerController) dlg.polymerController[k] = v; } catch { /* idem */ }
    }

    let choisi = false;
    dlg.addEventListener('video-picked', (ev) => {
      const v = ev.detail || {};
      if (!ID.test(v.videoId || '')) return;
      choisi = true;
      repondre({ videoId: v.videoId, titre: v.videoTitle || '' });
    });
    dlg.addEventListener('iron-overlay-closed', () => {
      if (!choisi) repondre({ annule: true });
      setTimeout(() => { if (selecteur === dlg) selecteur = null; dlg.remove(); }, 400);
    });
    setTimeout(() => {
      try { dlg.open(); repondre({ ouvert: true }); } catch { dlg.remove(); repondre({ indisponible: true }); }
    }, 50);
  });

  /* ------------------------------------ 3. video similaire, plusieurs Shorts */

  const fetchStudio = window.fetch;   // l'original, pour que nos envois ne soient pas relus
  let contexte = null;

  function retenir(corps) {
    if (!racine.classList.contains('yttools-similaire') || typeof corps !== 'string' || !corps.includes('"sessionInfo"')) return;
    try {
      const ctx = JSON.parse(corps).context;
      const jeton = ctx && ctx.request && ctx.request.sessionInfo && ctx.request.sessionInfo.token;
      if (typeof jeton === 'string' && jeton.length >= 40) contexte = ctx;
    } catch { /* corps illisible : on l'ignore */ }
  }

  // On n'ecoute les requetes de Studio qu'a partir du moment ou la fonction est
  // active sur l'onglet Shorts ; une fois en place, l'ecoute ne garde que le
  // dernier contexte, et seulement tant que la classe est presente.
  let ecoute = false;
  function ecouter() {
    if (ecoute || !racine.classList.contains('yttools-similaire')) return;
    ecoute = true;
    const API = /\/youtubei\/v1\//;
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (methode, url) {
      try { this.__yttoolsApi = API.test(String(url || '')); } catch { /* rien */ }
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (corps) {
      try { if (this.__yttoolsApi) retenir(corps); } catch { /* rien */ }
      return send.apply(this, arguments);
    };
    const f = window.fetch;
    window.fetch = function (entree, init) {
      try {
        const url = typeof entree === 'string' ? entree : (entree && entree.url) || '';
        if (API.test(url) && init) retenir(init.body);
      } catch { /* rien */ }
      return f.apply(this, arguments);
    };
  }
  setInterval(ecouter, 500);
  new MutationObserver(ecouter).observe(racine, { attributes: true, attributeFilter: ['class'] });

  async function signature() {
    const m = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/);
    if (!m) return null;
    const t = Math.floor(Date.now() / 1000);
    const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${t} ${m[1]} ${location.origin}`));
    return `SAPISIDHASH ${t}_${Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  /** Le contexte arrive avec la prochaine requete de Studio : on l'attend un peu. */
  async function attendreContexte(ms) {
    const fin = Date.now() + ms;
    while (!contexte && Date.now() < fin) await new Promise((r) => setTimeout(r, 150));
    return contexte;
  }

  async function changer(id, cible) {
    const ctx = await attendreContexte(4000);
    if (!ctx) return 'contexte';
    const cle = cfg('INNERTUBE_API_KEY');
    const auth = await signature();
    if (!cle || !auth) return 'session';
    const page = cfg('DELEGATED_SESSION_ID');
    const r = await fetchStudio.call(window, `/youtubei/v1/video_manager/metadata_update?alt=json&key=${encodeURIComponent(cle)}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        authorization: auth,
        'x-origin': location.origin,
        'x-goog-authuser': String(cfg('SESSION_INDEX') ?? 0),
        ...(page ? { 'x-goog-pageid': String(page) } : {})
      },
      body: JSON.stringify({
        context: ctx,
        encryptedVideoId: id,
        videoLinkageShortsAttribution: { targetExternalVideoId: cible ? [cible] : [] }
      })
    });
    if (!r.ok) return 'http' + r.status;
    const j = await r.json().catch(() => null);
    const code = j && j.overallResult && j.overallResult.resultCode;
    return code === 'UPDATE_SUCCESS' ? 'ok' : (code || 'vide');
  }

  let enCours = false;
  document.addEventListener('yttools-similaire-appliquer', async (e) => {
    const d = lire(e);
    if (!d || !d.ticket || enCours) return;
    const ids = Array.isArray(d.ids) ? d.ids.filter((x) => ID.test(x)) : [];
    const cible = d.cible || '';
    if (!ids.length || (cible && !ID.test(cible))) return;
    enCours = true;
    try {
      let bloquant = null;   // sans contexte ni session, inutile d'essayer les suivants
      for (let i = 0; i < ids.length; i++) {
        let res = bloquant || 'erreur';
        if (!bloquant) {
          try { res = await changer(ids[i], cible); } catch { res = 'erreur'; }
          if (res === 'contexte' || res === 'session') bloquant = res;
        }
        envoyer('yttools-similaire-progres', { ticket: d.ticket, id: ids[i], res, fait: i + 1, total: ids.length });
        // Un Short a la fois, avec une pause : le rythme d'une personne, pas d'un robot.
        if (i < ids.length - 1 && !bloquant) await new Promise((r) => setTimeout(r, 600));
      }
    } finally {
      enCours = false;
      envoyer('yttools-similaire-fini', { ticket: d.ticket });
    }
  });
})();
