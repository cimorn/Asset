import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},plugins:[react()],build:{outDir:'dist',emptyOutDir:true,chunkSizeWarningLimit:1400}});
