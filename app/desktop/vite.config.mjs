import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:here,publicDir:path.join(here,'../public'),resolve:{alias:{'@':path.join(here,'..')}},plugins:[react()],build:{outDir:path.join(here,'web-dist'),emptyOutDir:true,chunkSizeWarningLimit:1400}});
