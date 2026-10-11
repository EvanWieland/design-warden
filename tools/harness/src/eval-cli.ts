import fs from 'node:fs';
import path from 'node:path';
import { benchmarkMarkdown, evaluateBenchmark } from './eval.ts';
import { WORK_DIR } from './scenarios.ts';

const result = await evaluateBenchmark();
console.log(benchmarkMarkdown(result));
const out = path.join(WORK_DIR, 'eval', 'benchmark.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
