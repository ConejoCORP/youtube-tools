/*
 * Tags de la video, tout en bas de la description (tags.js).
 *
 * Les tags viennent du pont (rank-bridge.js, simule ici par l'attribut
 * data-yttools-rank-src) : aucune requete. On verifie l'emplacement (dernier
 * bloc du cadre de la description, repliee ou depliee), l'affichage, la copie,
 * les cas sans tags ou pont en retard, et qu'un clic dans le bloc ne deplie
 * pas la description.
 */
const { EXT } = require('./_outils');
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const COMMON = fs.readFileSync(EXT + 'common.js', 'utf8');
const TAGS = fs.readFileSync(EXT + 'tags.js', 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let echecs = 0;
const verifie = (nom, obtenu, attendu) => {
  const ok = obtenu === attendu;
  if (!ok) echecs++;
  console.log((ok ? '  OK   ' : '  ECHEC') + ' ' + nom + ' = ' + JSON.stringify(obtenu) +
    (ok ? '' : '   (attendu ' + JSON.stringify(attendu) + ')'));
};

const ID = 'abc123XYZ_1';
const pont = (id, tags) => JSON.stringify({ id, channel: 'UC' + 'x'.repeat(22), views: 10, published: '', tags });

function page({ tags = ['minecraft', 'minecraft fr', 'mc'], id = ID, reglages = {} } = {}) {
  const vc = new VirtualConsole();
  ['jsdomError', 'error', 'warn'].forEach((e) => vc.on(e, () => {}));

  // Le cadre de la description tel que YouTube le construit (repliee).
  const dom = new JSDOM(`<!doctype html><html lang="fr"><body>
    <ytd-watch-flexy><div id="primary">
      <ytd-watch-metadata>
        <div id="description">
          <div id="description-inner">
            <ytd-watch-info-text><div id="info">3,4 M de vues  il y a 3 ans</div></ytd-watch-info-text>
            <ytd-text-inline-expander id="description-inline-expander">
              <div id="snippet">Aujourd'hui chaque bloc...</div>
              <tp-yt-paper-button id="expand">afficher plus</tp-yt-paper-button>
              <tp-yt-paper-button id="collapse" hidden>Moins</tp-yt-paper-button>
            </ytd-text-inline-expander>
          </div>
        </div>
      </ytd-watch-metadata>
    </div></ytd-watch-flexy>
  </body></html>`,
  { url: 'https://www.youtube.com/watch?v=' + ID, runScripts: 'outside-only', virtualConsole: vc });

  const { window } = dom;
  const doc = window.document;
  if (tags !== undefined) doc.documentElement.setAttribute('data-yttools-rank-src', pont(id, tags));

  // Comme sur YouTube : description repliee, un clic dans son cadre la deplie.
  let deplie = false;
  doc.getElementById('description').addEventListener('click', () => { deplie = true; });

  let copie = null;
  let requetes = 0;
  window.chrome = { storage: { local: { get: async () => ({ yttoolsSettings: reglages }), set: async () => {} }, onChanged: { addListener: () => {} } } };
  window.navigator.clipboard = { writeText: async (t) => { copie = t; } };
  window.fetch = async () => { requetes++; throw new Error('aucune requete attendue'); };
  global.window = window;
  global.document = doc;
  global.NodeFilter = window.NodeFilter;

  window.eval(COMMON);
  window.eval(TAGS);
  return {
    window, doc,
    carte: () => doc.getElementById('yttools-tags-card'),
    interieur: () => doc.getElementById('description-inner'),
    lire: () => copie, requetes: () => requetes, deplie: () => deplie
  };
}

const texte = (el, sel) => (el.querySelector(sel) || {}).textContent;
const puces = (el) => [...el.querySelectorAll('.yttools-tg-chip')].map((c) => c.textContent);
const clic = (ctx, el) => el.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));

(async () => {
  console.log('1. Tout en bas de la description, avec les tags de la video');
  {
    const ctx = page();
    await wait(1200);
    const c = ctx.carte();
    verifie('bloc pose', !!c, true);
    verifie('dernier bloc du cadre de la description', ctx.interieur().lastElementChild, c);
    verifie('sous « afficher plus » (hors du texte replie)', c.previousElementSibling.id, 'description-inline-expander');
    verifie('nombre de tags dans l\'en-tete', texte(c, '.yttools-tg-value'), '3');
    verifie('un tag par puce', puces(c).join('|'), 'minecraft|minecraft fr|mc');
    // 9 + (12 + 2 guillemets) + 2 + 2 virgules
    verifie('compte a la maniere de YouTube Studio', texte(c, '.yttools-tg-count'), '27 / 500 caractères');
    clic(ctx, c.querySelector('.yttools-tg-copy'));
    await wait(50);
    verifie('copie : separes par des virgules', ctx.lire(), 'minecraft, minecraft fr, mc');
    verifie('le bouton le confirme', texte(c, '.yttools-tg-copy'), 'Copié ✓');
    verifie('aucune requete', ctx.requetes(), 0);
  }

  console.log('\n2. Un clic dans le bloc ne deplie pas la description');
  {
    const ctx = page();
    await wait(1200);
    const c = ctx.carte();
    clic(ctx, c.querySelector('.yttools-tg-chip'));
    clic(ctx, c.querySelector('.yttools-tg-copy'));
    clic(ctx, c.querySelector('.yttools-tg-toggle'));
    verifie('description toujours repliee', ctx.deplie(), false);
    verifie('l\'en-tete plie le bloc', c.dataset.collapsed, 'true');
    verifie('mais un clic ailleurs dans le cadre la deplie toujours', (clic(ctx, ctx.doc.getElementById('snippet')), ctx.deplie()), true);
  }

  console.log('\n3. Reste en bas quand YouTube ajoute un bloc apres lui (description depliee)');
  {
    const ctx = page();
    await wait(1200);
    const ajout = ctx.doc.createElement('ytd-structured-description-content-renderer');
    ctx.interieur().append(ajout);
    await wait(900);
    verifie('de nouveau le dernier', ctx.interieur().lastElementChild, ctx.carte());
    verifie('le bloc de YouTube garde sa place', ajout.isConnected && ajout.nextElementSibling === ctx.carte(), true);
  }

  console.log('\n4. Un tag n\'est jamais du HTML');
  {
    const ctx = page({ tags: ['<img src=x onerror=alert(1)>'] });
    await wait(1200);
    verifie('aucune image creee', ctx.carte().querySelector('img'), null);
    verifie('affiche tel quel', puces(ctx.carte())[0], '<img src=x onerror=alert(1)>');
  }

  console.log('\n5. Video sans tags, pont en retard, nouvelle video');
  {
    const vide = page({ tags: [] });
    await wait(1200);
    verifie('sans tags : message', texte(vide.carte(), '.yttools-tg-msg'), 'Aucun tag sur cette vidéo.');
    verifie('sans tags : 0 dans l\'en-tete', texte(vide.carte(), '.yttools-tg-value'), '0');
    verifie('sans tags : pas de bouton Copier', vide.carte().querySelector('.yttools-tg-copy').hidden, true);

    const retard = page({ id: 'autreVideo1' });
    await wait(1200);
    verifie('pont sur la video precedente : on attend', texte(retard.carte(), '.yttools-tg-msg'), 'Lecture des tags…');
    verifie('jamais les tags d\'une autre video', puces(retard.carte()).length, 0);

    // Le pont publie la bonne video : changement d'attribut seulement.
    retard.doc.documentElement.setAttribute('data-yttools-rank-src', pont(ID, ['speedrun']));
    await wait(100);
    verifie('mis a jour des la publication', puces(retard.carte()).join('|'), 'speedrun');
    verifie('le bouton Copier revient', retard.carte().querySelector('.yttools-tg-copy').hidden, false);
  }

  console.log('\n6. Reglage coupe : pas de bloc');
  {
    const ctx = page({ reglages: { videoTags: false } });
    await wait(1200);
    verifie('aucun bloc', ctx.carte(), null);
  }

  console.log('\n' + (echecs ? echecs + ' ECHEC(S)' : 'tout passe'));
  process.exit(echecs ? 1 : 0);
})();
