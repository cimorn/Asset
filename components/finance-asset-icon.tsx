'use client';
import {useState} from 'react';
import {assetBrand,type AssetIdentity} from '@/lib/asset-brands';

export default function AssetIcon({asset,className='',onClick}:{asset:AssetIdentity;className?:string;onClick?:()=>void}){
 const brand=assetBrand(asset),[failed,setFailed]=useState<string>();
 const showLogo=brand&&failed!==brand.file,src=brand?`/asset-logos/${brand.file}`:'';
 const content=asset.icon?<span className="asset-brand-image"><img src={asset.icon} alt="" width={32} height={32}/></span>:showLogo?<span className="asset-brand-image">
   {brand.crop?<svg viewBox={brand.crop.viewBox} aria-hidden="true" focusable="false"><image href={src} width={brand.crop.width} height={brand.crop.height} onError={()=>setFailed(brand.file)}/></svg>:<img src={src} alt="" width={32} height={32} loading="lazy" decoding="async" onError={()=>setFailed(brand.file)}/>}
  </span>:asset.name.trim().slice(0,1)||'·';
 const classes=`asset-symbol ${showLogo||asset.icon?'asset-brand':''} ${onClick?'asset-icon-button':''} ${className}`;
 return onClick?<button type="button" className={classes} title="更换图标" aria-label={`更换${asset.name}图标`} onClick={onClick}>{content}</button>:<span className={classes} title={showLogo?brand.label:asset.name}>{content}</span>;
}
