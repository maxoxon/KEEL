import { hook } from "./keelhook.mjs";
export function makePi(){
  const handlers={};
  const pi={ on:(ev,fn)=>{ (handlers[ev]??=[]).push(fn); }, sendMessage:(m)=>{ pi._sent.push(m); }, _sent:[] };
  hook(pi);
  return { pi, handlers,
    emit: async (ev, event, ctx) => {
      const out=[];
      for(const h of handlers[ev]??[]) out.push(await h(event, ctx));
      return out.filter(r=>r!==undefined && r!==null);
    }};
}
export function makeCtx(cwd,{hasUI=true,confirm=true}={}){
  const status={};
  return { cwd, hasUI, ui:{ setStatus:(k,v)=>{status[k]=v;}, confirm: async()=>confirm }, _status:status };
}
