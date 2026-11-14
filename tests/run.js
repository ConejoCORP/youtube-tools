'use strict';

/**
 * Lance tous les tests (tests/test-*.js) et resume.
 *   cd tests && npm install && node run.js
 *
 * Aucun de ces tests n'interroge le reseau : YouTube, GitHub et Gemini y sont
 * simules. Le test qui touche les vraies chaines publiques est a part :
 * youtube-tools/tests/rank-core.test.js.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const fichiers = fs.readdirSync(__dirname).filter((f) => /^test-.+\.js$/.test(f)).sort();
let echecs = 0;
for (const f of fichiers) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 180000 });
  const sortie = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n');
  const ok = r.status === 0;
  if (!ok) echecs++;
  console.log(`${ok ? 'OK    ' : 'ECHEC '} ${f.padEnd(24)} ${sortie[sortie.length - 1] || ''}`);
  if (!ok) console.log(sortie.filter((l) => /ECHEC|Error/.test(l)).slice(0, 10).map((l) => '        ' + l).join('\n'));
}
console.log(echecs ? `\n${echecs} fichier(s) en echec` : `\n${fichiers.length} fichiers : tout passe`);
process.exit(echecs ? 1 : 0);
