import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const packaged=['app','app.asar'].includes(path.basename(here))&&path.basename(path.dirname(here))==='resources';
const root=process.env.PORTABLE_EXECUTABLE_DIR
 ?path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'FinanceAtlas')
 :path.resolve(here,packaged?'../..':'..');
// Portable resources are temporary; keep imported configuration in the user data directory.
export const envPath=path.join(root,'.env');
