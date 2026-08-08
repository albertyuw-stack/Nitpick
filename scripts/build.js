import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = cmd => execSync(cmd, { cwd: root, stdio: 'inherit' });

run('vite build');
run('vite build --config vite.background.config.ts');
run('vite build --config vite.content.config.ts');

fs.copyFileSync(path.join(root, 'manifest.json'), path.join(root, 'dist/manifest.json'));

// Vite emits the panel html at dist/index.html (root: src/sidepanel); the
// manifest expects sidepanel.html.
const emitted = path.join(root, 'dist/index.html');
if (fs.existsSync(emitted)) {
  fs.renameSync(emitted, path.join(root, 'dist/sidepanel.html'));
}

console.log('\nBuild complete → dist/');
