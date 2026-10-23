export async function prepareCredentials(credentials,{chooseFile,showError}){
 let state=await credentials.status();if(state.configured)return true;
 for(;;){
  const target=await chooseFile(state.error);if(!target)return false;
  try{await credentials.configure(target);return true;}
  catch(error){state={error:error.safe?error.message:'无法读取 .env，请重新选择。'};if(!await showError(state.error))return false;}
 }
}
