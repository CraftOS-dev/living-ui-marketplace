// Small A2App client for a harness's bounded smoke test. It does not decide the verdict.
import {request,operation} from "./client.mjs";
const [action,id,answer,decision,...words]=process.argv.slice(2);
if(action==="inspect"){
 const record=await request("/api/collections/requests/records/"+encodeURIComponent(id));
 const evidence=await request("/api/collections/proofs/records/"+encodeURIComponent(record.evidence));
 console.log(JSON.stringify({request:record,evidence},null,2));
}else if(action==="submit"){
 const record=await operation("submit-proof-result",{request:id,answer:Number(answer),decision,summary:words.join(" ")});
 console.log(JSON.stringify({id:record.id,status:record.status,summary:record.summary}));
}else{console.error("Use inspect <request-id> or submit <request-id> <answer> <passed|blocked> <summary>.");process.exitCode=2;}
