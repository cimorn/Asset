'use client';
import {type Book} from '@/lib/finance';
import PortfolioSummary,{AssetTrend} from './finance-dashboard';
import {IncomeCurve} from './finance-investments';
import {gainHistory} from '@/lib/investing';
import {today} from '@/lib/finance';

export default function Overview({book,base,hidden}:{book:Book;base:string;hidden:boolean}){
 const history=gainHistory(book,today());
 return <>
  <PortfolioSummary book={book} base={base} hidden={hidden}/>
  <div className="overview-main-curves"><AssetTrend book={book} base={base} hidden={hidden}/><IncomeCurve book={book} history={history} hidden={hidden} kind="total"/></div>
  <div className="overview-classification-curves">{(['股票','黄金','虚拟币'] as const).map(kind=><IncomeCurve book={book} history={history} hidden={hidden} kind={kind} key={kind}/>)}</div>
 </>;
}
