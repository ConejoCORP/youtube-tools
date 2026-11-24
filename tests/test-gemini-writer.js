/*
 * Pilote de Gemini (gemini-writer.js) contre une maquette de gemini.google.com.
 *
 * Le comportement reprend celui de test/gemini-mock.html de Google More :
 * zone Quill, bouton d'envoi qui n'apparait qu'avec du texte, bouton
 * « Arreter » pendant la redaction, raisonnement dans <model-thoughts>, reponse
 * diffusee par morceaux AVEC UNE PAUSE au milieu, puis <message-actions>.
 */
const { EXT, RACINE, lireDump } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const WRITER = fs.readFileSync(EXT + 'gemini-writer.js', 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, ok, detail) => {
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + (ok || detail === undefined ? '' : '   -> ' + JSON.stringify(detail)));
};

/** morceaux : HTML diffuse un a un dans la reponse. pause : silence au milieu. */
function gemini({ morceaux, pause = 1500, connecte = true, chrome = null }) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));
  const dom = new JSDOM(`<!doctype html><html lang="fr"><body>
    ${connecte ? '' : '<a href="#">Se connecter</a>'}
    <chat-window><div id="log"></div></chat-window>
    <input-area-v2>
      <button aria-label="Importation et outils">+</button>
      <rich-textarea><div class="ql-editor ql-blank" contenteditable="true" role="textbox"><p><br></p></div></rich-textarea>
      <div class="send-button" id="wrap" hidden><button id="send" aria-label="Envoyer un message">➤</button></div>
    </input-area-v2>
  </body></html>`, { url: 'https://gemini.google.com/app', runScripts: 'outside-only', virtualConsole: vc });

  const { window } = dom;
  const doc = window.document;
  // jsdom ne calcule pas de mise en page : sans ca, rien n'est « visible ».
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20 });

  const editor = doc.querySelector('.ql-editor');
  const wrap = doc.getElementById('wrap');
  const btn = doc.getElementById('send');
  const etat = { prompt: null, envois: 0 };

  editor.addEventListener('input', () => { wrap.hidden = !editor.textContent.trim(); });

  btn.addEventListener('click', async () => {
    if (btn.getAttribute('aria-label') !== 'Envoyer un message') return;
    etat.envois++;
    etat.prompt = editor.textContent;
    editor.innerHTML = '<p><br></p>';
    btn.setAttribute('aria-label', 'Arrêter la réponse');
    wrap.classList.add('stop');

    const resp = doc.createElement('model-response');
    resp.innerHTML = '<model-thoughts><div class="markdown"><h2>Raisonnement</h2><p>Je réfléchis…</p></div></model-thoughts>'
      + '<message-content><div class="markdown markdown-main-panel"></div></message-content>';
    doc.getElementById('log').appendChild(resp);
    const panel = resp.querySelector('message-content .markdown');

    await sleep(600);
    for (let i = 0; i < morceaux.length; i++) {
      const tmp = doc.createElement('div');
      tmp.innerHTML = morceaux[i];
      while (tmp.firstChild) panel.appendChild(tmp.firstChild);
      await sleep(i === 1 ? pause : 150);         // la pause au milieu de la redaction
    }
    btn.setAttribute('aria-label', 'Envoyer un message');
    wrap.classList.remove('stop');
    wrap.hidden = true;
    const actions = doc.createElement('message-actions');
    actions.innerHTML = '<button aria-label="Copier">📋</button>';
    resp.appendChild(actions);
  });

  if (chrome) window.chrome = chrome;
  global.window = window; global.document = doc;
  window.eval(WRITER);
  return { window, etat };
}

const RESUME = [
  '<h2>En bref</h2>',
  '<p>Une vidéo de test <b>importante</b> sur un jeu.<mat-icon>content_copy</mat-icon></p>',
  '<h2>Points clés</h2><ul><li><p>[0:00] Présentation</p></li><li>[0:31] Les règles<ul><li>[0:40] un détail</li></ul></li></ul>',
  '<h2>À retenir</h2><p>Le jeu devient dur vers [1:12].<sup>1</sup></p>'
];

(async () => {
  console.log('1. Ecriture, envoi, attente et lecture par blocs');
  {
    const { window, etat } = gemini({ morceaux: RESUME });
    const t0 = Date.now();
    const blocs = await window.__yttoolsGemini.run('Résume cette vidéo.\nTranscription :\n[0:00] Salut', 60000);
    const types = blocs.map((b) => b.type).join(' ');
    verifie('prompt ecrit dans Gemini', etat.prompt && /Résume cette vidéo/.test(etat.prompt), etat.prompt);
    verifie('envoye une seule fois', etat.envois === 1, etat.envois);
    verifie('structure reconstruite', types === 'h p h li li li h p', types);
    verifie('titres sans diese', blocs.filter((b) => b.type === 'h').map((b) => b.text).join('|') === 'En bref|Points clés|À retenir');
    verifie('le raisonnement de Gemini est exclu', !blocs.some((b) => /Raisonnement|réfléchis/.test(b.text)));
    verifie('icones et renvois retires', !blocs.some((b) => /content_copy/.test(b.text)) &&
      blocs[blocs.length - 1].text === 'Le jeu devient dur vers [1:12].', blocs[blocs.length - 1].text);
    verifie('sous-puce gardee', blocs.some((b) => b.type === 'li' && b.text === '[0:40] un détail'));
    verifie('sous-puce reconnue comme telle (profondeur 1)',
      blocs.find((b) => b.text === '[0:40] un détail').depth === 1 && blocs.find((b) => b.text === '[0:31] Les règles').depth === 0);
    verifie('niveau des titres garde (## = 2)', blocs.filter((b) => b.type === 'h').every((b) => b.level === 2));
    verifie('n’a pas coupe a la pause du milieu', blocs.length === 8, blocs.length);
    console.log('     (duree : ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  }

  console.log('\n2. Reponse rendue dans un bloc de code');
  {
    const { window } = gemini({
      morceaux: ['<pre><code>## En bref\nUn résumé.\n\n## Points clés\n- [0:05] Un **point**\n- [0:20] Un autre\n</code></pre>'],
      pause: 0
    });
    const blocs = await window.__yttoolsGemini.run('Résume.', 60000);
    verifie('Markdown brut relu', blocs.map((b) => b.type).join(' ') === 'h p h li li', blocs);
    verifie('gras retire', blocs.some((b) => b.text === '[0:05] Un point'));
    const { window: w2 } = gemini({
      morceaux: ['<pre><code>## Chapitres\n### Intro [0:00]\n- Le défi [0:12]\n  - un détail [0:20]\n</code></pre>'],
      pause: 0
    });
    const b2 = await w2.__yttoolsGemini.run('Résume.', 60000);
    verifie('Markdown brut : niveaux de titres et sous-puce indentee',
      b2.map((b) => b.type + (b.level || '') + (b.type === 'li' ? b.depth : '')).join(' ') === 'h2 h3 li0 li1', b2);
  }

  console.log('\n3. Paragraphe tout en gras = titre');
  {
    const { window } = gemini({ morceaux: ['<p><strong>En bref</strong></p><p>Texte.</p>'], pause: 0 });
    const blocs = await window.__yttoolsGemini.run('Résume.', 60000);
    verifie('reconnu comme titre', blocs[0] && blocs[0].type === 'h' && blocs[0].text === 'En bref', blocs);
  }

  console.log('\n3 bis. Gras et citations gardes (reponses aux questions)');
  {
    const { window } = gemini({
      morceaux: ['<p>Deux personnes en parlent.</p><ul><li><p><strong>Le titre</strong> : un accord.</p></li></ul>'
        + '<blockquote><p>@margot.r : « vis » est féminin</p></blockquote>'],
      pause: 0
    });
    const blocs = await window.__yttoolsGemini.run('Question.', 60000);
    const li = blocs.find((b) => b.type === 'li');
    verifie('passage en gras garde a cote du texte nu', li && li.text === 'Le titre : un accord.' && li.gras && li.gras[0] === 'Le titre', li);
    const cite = blocs.find((b) => b.cite);
    verifie('citation reconnue', cite && cite.type === 'p' && cite.text === '@margot.r : « vis » est féminin', blocs);
    verifie('pas de gras : pas de champ en plus', !('gras' in blocs[0]));
    const md = window.__yttoolsGemini.blocDeLigne('> @lea : « super **vidéo** »');
    verifie('Markdown brut : « > » = citation, gras releve', md && md.cite && md.text === '@lea : « super vidéo »' && md.gras[0] === 'vidéo', md);
  }

  console.log('\n4. Liaison avec l’extension (le chemin reel)');
  for (const connecte of [false, true]) {
    const recus = [];
    let ecouteur = null;
    const port = {
      postMessage: (m) => { if (m.type !== 'ping') recus.push(m); },
      onMessage: { addListener: (fn) => { ecouteur = fn; } },
      onDisconnect: { addListener: () => {} }
    };
    gemini({
      morceaux: RESUME, pause: 0, connecte,
      chrome: { runtime: { id: 'test', connect: (o) => { port.nom = o.name; return port; } } }
    });
    const qui = connecte ? 'connecte' : 'deconnecte';
    verifie(qui + ' : port ouvert sous le bon nom', port.nom === 'yttools-gemini', port.nom);
    ecouteur({ type: 'start', prompt: 'Résume.', timeoutMs: 60000 });
    for (let i = 0; i < 150 && !recus.length; i++) await sleep(100);
    const r = recus[0] || {};
    if (connecte) verifie(qui + ' : blocs renvoyes', r.type === 'done' && r.blocks.length === 8, r);
    else verifie(qui + ' : erreur « login », rien n’est envoye', r.type === 'error' && r.error === 'login', r);
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
