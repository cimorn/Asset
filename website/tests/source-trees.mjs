import {existsSync} from 'node:fs';

// The public repository is standalone. Local development can additionally
// exercise the adjacent desktop implementation when it is present.
export const sourceTrees=[['website',new URL('../',import.meta.url)]];
const desktop=new URL('../../app/',import.meta.url);
if(existsSync(new URL('desktop/package.json',desktop))&&existsSync(new URL('lib/finance.ts',desktop))){
 sourceTrees.push(['app',desktop]);
}
