import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
await mkdir('desktop/runtime',{recursive:true});
await build({entryPoints:['lib/finance.ts'],outfile:'desktop/runtime/finance.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','desktop/vite.config.mjs'],{stdio:'inherit'});
process.exitCode=result.status??1;
