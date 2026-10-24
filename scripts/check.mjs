import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const folder of ['.', 'lib', 'public', 'scripts', 'test']) {
  for (const file of readdirSync(folder).filter(name => /\.(mjs|js)$/.test(name))) {
    const result = spawnSync(process.execPath, ['--check', `${folder}/${file}`], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log('JavaScript syntax checks passed.');
