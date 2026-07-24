"use client";
import { useEffect, useState } from "react";
import type { WorkspaceExtension } from "../types";
/** A board-action iframe is presentational until a future capability is granted;
 * it has no access to the parent document, cookies, or workspace data. */
export function BoardExtensionActions({workspaceId}:{workspaceId:string}){const [extensions,setExtensions]=useState<WorkspaceExtension[]>([]);useEffect(()=>{void fetch(`/api/workspaces/${workspaceId}/extensions`,{cache:"no-store"}).then(r=>r.ok?r.json():[]).then((items:WorkspaceExtension[])=>setExtensions(items.filter(item=>item.slots.includes("board_action")))).catch(()=>setExtensions([]));},[workspaceId]);if(!extensions.length)return null;return <span className="flex items-center gap-1">{extensions.map(extension=><iframe key={extension.id} title={extension.name} src={extension.url} sandbox="allow-scripts" className="h-8 max-w-36 rounded border" />)}</span>;}
