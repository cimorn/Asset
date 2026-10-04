import {createHash} from 'node:crypto';
import {canonical} from '../shared/merge.mjs';
export {canonical,same,mergeBooks} from '../shared/merge.mjs';
export const digest=value=>createHash('sha256').update(canonical(value)??'undefined').digest('hex');
