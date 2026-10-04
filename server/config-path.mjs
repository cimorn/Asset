import {fileURLToPath} from 'node:url';
// Compatibility for the application-only client; production credentials come from process.env.
export const envPath=fileURLToPath(new URL('../.env',import.meta.url));
