"use client";
import { useEffect, useRef, useState } from "react";
import { scopeForCapability, type ExtensionSlot, type WorkspaceExtension } from "../types";

/** Iframes have no same-origin privileges and never receive session cookies from
 * the parent. The parent mediates a tiny, read-only postMessage bridge, tied to
 * both task and installed-extension IDs on the server.
 *
 * An iframe asks by capability name (`task.read`, `comments.read`, …); this
 * translates it to the bridge's scope and forwards nothing else. The check here
 * is a shape check, not a security boundary — a request for a capability the
 * manifest never asked for is refused by the server regardless, which is where
 * the grant actually lives. */
export function TaskExtensionPanels({taskId,slot="task_panel",compact=false}:{taskId:number;slot?:ExtensionSlot;compact?:boolean}){const [extensions,setExtensions]=useState<WorkspaceExtension[]>([]);const frames=useRef(new Map<number,HTMLIFrameElement>());useEffect(()=>{void fetch(`/api/tasks/${taskId}/extensions?slot=${slot}`,{cache:"no-store"}).then(r=>r.ok?r.json():[]).then(setExtensions).catch(()=>setExtensions([]));},[taskId,slot]);useEffect(()=>{const onMessage=(event:MessageEvent)=>{const extension=extensions.find(x=>new URL(x.url).origin===event.origin&&frames.current.get(x.id)?.contentWindow===event.source);const data=event.data as {type?:string;requestId?:string;method?:string};const scope=scopeForCapability(data?.method);if(!extension||data?.type!=="kanban.extension.request"||!scope||typeof data.requestId!=="string")return;void fetch(`/api/tasks/${taskId}/extensions/${extension.id}/bridge?scope=${scope}`,{cache:"no-store"}).then(async response=>({ok:response.ok,body:await response.json().catch(()=>null)})).then(({ok,body})=>frames.current.get(extension.id)?.contentWindow?.postMessage({type:"kanban.extension.response",requestId:data.requestId,ok,body},event.origin));};window.addEventListener("message",onMessage);return()=>window.removeEventListener("message",onMessage);},[extensions,taskId]);if(!extensions.length)return null;const body=<>{extensions.map(extension=><iframe key={extension.id} ref={node=>{if(node)frames.current.set(extension.id,node);else frames.current.delete(extension.id);}} title={extension.name} src={extension.url} sandbox="allow-scripts" className={compact?"h-7 max-w-32 rounded border":"min-h-24 w-full rounded-md border"} />)}</>;return compact?<span className="flex gap-1">{body}</span>:<section className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">Extensions</p>{body}</section>;}
