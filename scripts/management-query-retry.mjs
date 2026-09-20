/** Only reads may retry automatically; a lost write response has an unknown outcome. */
export async function managementRequest(operation,{readOnly=false,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const attempts=readOnly?4:1;
 for(let attempt=0;attempt<attempts;attempt++){
  let response;
  try{response=await operation();}
  catch(error){
   if(attempt+1===attempts)throw error;
   await pause(1000*2**attempt);continue;
  }
  if(!readOnly||![429,502,503,504].includes(response.status)||attempt+1===attempts)return response;
  await response.text(); // Release the response body before retrying.
  await pause(1000*2**attempt);
 }
 throw new Error('Management request did not complete.');
}
