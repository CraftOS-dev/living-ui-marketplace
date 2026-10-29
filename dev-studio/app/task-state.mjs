import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {ROOT,appPort} from "./config.mjs";
let timer;
export async function frameworkRequest(path,body) {
  const token=(await readFile(join(ROOT,".agent-token"),"utf8")).trim();
  const response=await fetch("http://127.0.0.1:"+appPort()+path,{
    method:body?"POST":"GET",headers:{"content-type":"application/json","x-a2app-token":token},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(4000),
  });
  if(response.status===404)return {status:"pruned"};
  if(!response.ok)throw new Error("The framework task receipt is unavailable. Refresh the connection before retrying.");
  return response.json();
}
export const taskReceipt=id=>frameworkRequest("/api/_a2app/tasks/"+encodeURIComponent(id));
export async function syncRequests(store) {
  let updated=0;
  for(const row of store.list("requests").filter(r=>r.status==="queued"&&r.agentTask).slice(0,20)){
    const task=await taskReceipt(row.agentTask);
    if(["failed","canceled","completed","pruned"].includes(task.status)){
      // A completed transport without a domain result is not a successful review.
      row.status=task.status==="canceled"?"canceled":"failed";
      row.summary=task.status==="pruned"?"The framework task receipt expired. Create a new review.":task.status==="canceled"?"The framework task was cancelled.":
        task.status==="completed"?"The harness finished without submitting a review. Create a new request.":
        "The harness run failed ("+(task.reason||"execution failed")+"). Check its login and permissions before retrying.";
      row.finished=new Date().toISOString();store.put("requests",row);updated++;
    }
  }
  return {updated};
}
export function watchRequests(store) {
  if(timer)return;
  timer=setTimeout(async()=>{
    timer=null;
    try {await frameworkRequest("/api/ops/sync-proof-requests",{});}
    catch { /* bounded retry while an unfinished request exists; no task is re-dispatched */ }
    if(store.list("requests").some(r=>r.status==="queued"&&r.agentTask))watchRequests(store);
  },2500);
  timer.unref();
}
