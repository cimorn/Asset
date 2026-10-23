export type AssetIdentity={name:string;code?:string;platform?:string;currency?:string;category?:string;icon?:string};
type Brand={label:string;file:string;crop?:{viewBox:string;width:number;height:number}};

export const assetBrands:Record<string,Brand>={
 invesco:{label:'Invesco 景顺',file:'invesco.png'},
 nvidia:{label:'NVIDIA 英伟达',file:'nvidia.ico'},
 apple:{label:'Apple 苹果',file:'apple.ico'},
 spacex:{label:'SpaceX',file:'spacex.png'},
 tesla:{label:'Tesla 特斯拉',file:'tesla.png'},
 sandisk:{label:'Sandisk 闪迪',file:'sandisk.ico'},
 guotai:{label:'国泰基金',file:'guotai.png'},
 southern:{label:'南方基金',file:'southern-logo.png',crop:{viewBox:'32 0 56 44',width:121,height:88}},
 changsheng:{label:'长盛基金',file:'changsheng-logo.png',crop:{viewBox:'0 0 34 34',width:278,height:34}},
 orient:{label:'东方基金',file:'orient.ico'},
 jpmorgan:{label:'摩根资产管理',file:'jpmorgan.ico'},
 bocim:{label:'中银基金',file:'bocim.ico'},
 huaan:{label:'华安基金',file:'huaan-logo.png',crop:{viewBox:'0 0 47 50',width:334,height:50}},
 za:{label:'ZA Bank 众安银行',file:'za.png'},
 sdic:{label:'国投证券',file:'sdic-logo.png',crop:{viewBox:'0 0 68 32',width:169,height:32}},
 alipay:{label:'支付宝',file:'alipay.ico'},
 boc:{label:'中国银行',file:'bocim.ico'},
};
const tickers:Record<string,string>={QQQ:'invesco',NVDA:'nvidia',AAPL:'apple',TSLA:'tesla',SNDK:'sandisk'};
const fundCodes:Record<string,string>={'513100':'guotai','513800':'southern','015736':'changsheng','400030':'orient','007329':'jpmorgan','001235':'bocim','000217':'huaan'};
const platforms:Record<string,string>={'众安':'za','众安银行':'za','ZA BANK':'za','国投':'sdic','国投证券':'sdic','支付宝':'alipay','中国银行':'boc'};

export function assetBrand(asset:AssetIdentity):Brand|undefined{
 if(asset.category==='现金')return assetBrands[platforms[(asset.platform||asset.name).trim().toUpperCase()]];
 const code=(asset.code??'').trim().toUpperCase();
 if(tickers[code])return assetBrands[tickers[code]];
 // Keep the user's stored code untouched; normalize omitted zeroes for lookup only.
 if(/^\d{1,6}$/.test(code)&&(!asset.currency||asset.currency==='CNY')){
  const issuer=fundCodes[code.padStart(6,'0')];
  if(issuer)return assetBrands[issuer];
 }
 // This user-entered holding is identified by its name, not an inferred ticker.
 if(/^spacex$/i.test(asset.name.trim()))return assetBrands.spacex;
 return undefined;
}
