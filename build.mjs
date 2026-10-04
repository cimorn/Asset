import {build as bundle} from 'esbuild';
import {build} from 'vite';
await bundle({entryPoints:['lib/finance.ts'],outfile:'server/runtime/finance.mjs',bundle:true,platform:'node',format:'esm',target:'node22'});
await build();
