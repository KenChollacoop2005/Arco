import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { easternDate, datesFrom, dailyPath, makeDaily } from '../js/core/daily.js';

const DEFAULT_DAYS = 30; // days written when --days is not given
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// node tools/make-dailies.js [--days N] [--from YYYY-MM-DD] [--force]
const args = process.argv.slice(2);
const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const days = Number(value('--days')) || DEFAULT_DAYS;
const from = value('--from') || easternDate();
const force = args.includes('--force');

const exists = (path) => access(path).then(() => true, () => false);

await mkdir(join(ROOT, 'puzzles'), { recursive: true });
for (const date of datesFrom(from, days)) {
  const path = join(ROOT, dailyPath(date));
  // Published days never change unless forced
  if (!force && (await exists(path))) {
    console.log(`${date} kept`);
    continue;
  }
  const started = Date.now();
  const puzzle = makeDaily(date);
  await writeFile(path, JSON.stringify(puzzle) + '\n');
  console.log(`${date} rerolls ${puzzle.rerolls} par ${puzzle.par.points} residents ${puzzle.residents.length} ${Date.now() - started} ms`);
}
