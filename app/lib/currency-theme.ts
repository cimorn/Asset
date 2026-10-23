import type {CSSProperties} from 'react';

const palettes=[
 {ink:'#486b96',accent:'#87aacf',soft:'#eaf2fc',wash:'#f9fbfe',edge:'#d7e4f4'},
 {ink:'#4c7663',accent:'#8ab7a0',soft:'#ebf5ef',wash:'#f9fcfa',edge:'#d8e9df'},
 {ink:'#a05868',accent:'#d19aa5',soft:'#faedf0',wash:'#fefafb',edge:'#eed9df'},
 {ink:'#617692',accent:'#9bafc9',soft:'#edf2f8',wash:'#fafcfe',edge:'#dfe7f1'},
 {ink:'#8a6c55',accent:'#c8af95',soft:'#f8f1e9',wash:'#fdfbf8',edge:'#ece0d3'},
 {ink:'#796591',accent:'#b4a5cc',soft:'#f2edf8',wash:'#fcfafe',edge:'#e5ddef'},
 {ink:'#587b82',accent:'#96bbc1',soft:'#edf5f6',wash:'#f9fcfc',edge:'#dce9eb'},
];
export function currencyTheme(currency:string){
 const code=currency.toUpperCase();
 const fixed:Record<string,number>={CNY:0,USD:1,HKD:2,EUR:3,JPY:4,GBP:5,AUD:6};
 let hash=0;for(const character of code)hash=(hash*31+character.charCodeAt(0))>>>0;
 return palettes[fixed[code]??hash%palettes.length];
}
export function currencyStyle(currency:string):CSSProperties{
 const theme=currencyTheme(currency);
 return {'--currency-ink':theme.ink,'--currency-accent':theme.accent,'--currency-soft':theme.soft,'--currency-wash':theme.wash,'--currency-edge':theme.edge} as CSSProperties;
}
