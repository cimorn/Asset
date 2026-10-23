// Official Mongo initialization runs only on a new data directory, bound to
// localhost until this script completes. The final mongod always uses --auth.
// Reuse the existing asset application credential without logging it.
const AssetStorageURL=require('url').URL;
let uri;try{uri=new AssetStorageURL(process.env.MONGODB_URI);}catch{throw new Error('Asset application database configuration is invalid');}
if(uri.protocol!=='mongodb:'||decodeURIComponent(uri.username)!=='asset_app'||uri.pathname!=='/asset'||uri.searchParams.get('authSource')!=='asset'||!uri.password)throw new Error('Asset application database configuration is invalid');
const assetDatabase=db.getSiblingDB('asset');
if(assetDatabase.getUser('asset_app'))throw new Error('Asset database initialization requires an empty application account');
assetDatabase.createUser({user:'asset_app',pwd:decodeURIComponent(uri.password),roles:[{role:'readWrite',db:'asset'}]});
