"use client";

import { Lock, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RichText } from "@/shared/ui/rich-text";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import { fetchMembers } from "@/features/workspaces/client/api";
import type { Member } from "@/features/workspaces/types";
import * as api from "../client/api";
import type { Channel, ChannelMember, ChatMessage } from "../types";

/** DM channels are named "dm:Alice & Bob" by the server; the list shows the pair without the plumbing prefix. */
const channelLabel=(c:Channel)=>c.name.startsWith("dm:")?c.name.slice(3):`# ${c.name}`;

export function ChatButton({workspaceId,canEdit,currentUserId}:{workspaceId:string;canEdit:boolean;currentUserId:string}){const[open,setOpen]=useState(false);return <><Button variant="ghost" size="sm" className="text-muted-foreground" onClick={()=>setOpen(true)}><MessageCircle/> Chat</Button><ChatDialog workspaceId={workspaceId} canEdit={canEdit} currentUserId={currentUserId} open={open} onOpenChange={setOpen}/></>}

function ChatDialog({workspaceId,canEdit,currentUserId,open,onOpenChange}:{workspaceId:string;canEdit:boolean;currentUserId:string;open:boolean;onOpenChange:(v:boolean)=>void}){
 const[channels,setChannels]=useState<Channel[]>([]);const[selected,setSelected]=useState<Channel|null>(null);const[messages,setMessages]=useState<ChatMessage[]>([]);const[body,setBody]=useState("");const[name,setName]=useState("");const[isPrivate,setIsPrivate]=useState(false);const[error,setError]=useState<string|null>(null);
 const[replyTo,setReplyTo]=useState<ChatMessage|null>(null);const[roster,setRoster]=useState<Member[]>([]);const[chMembers,setChMembers]=useState<ChannelMember[]>([]);const[manage,setManage]=useState(false);
 async function loadChannels(){const next=await api.fetchChannels(workspaceId);setChannels(next);setSelected(current=>next.find(x=>x.id===current?.id)??next[0]??null);}
 async function loadMessages(id:number){setMessages(await api.fetchMessages(id));
  // Reading the channel is what "seen" means — move the marker and clear the dot.
  void api.markChannelSeen(id).catch(()=>{});setChannels(cs=>cs.map(c=>c.id===id&&c.hasUnread?{...c,hasUnread:false}:c));}
 useEffect(()=>{if(!open)return;const t=setTimeout(()=>{void loadChannels().catch(e=>setError(e.message));void fetchMembers(workspaceId).then(r=>setRoster(r.members)).catch(()=>{});},0);
  // Channels poll slower than messages: the dots only need to keep up with people, not keystrokes.
  const poll=setInterval(()=>void loadChannels().catch(()=>{}),15000);return()=>{clearTimeout(t);clearInterval(poll);};},[open,workspaceId]);
 useEffect(()=>{if(!selected)return;setReplyTo(null);setManage(false);const first=setTimeout(()=>void loadMessages(selected.id).catch(e=>setError(e.message)),0);const t=setInterval(()=>void loadMessages(selected.id).catch(()=>{}),5000);return()=>{clearTimeout(first);clearInterval(t);};},[selected?.id]);
 useEffect(()=>{if(!selected?.isPrivate||!manage)return;const t=setTimeout(()=>void api.fetchChannelMembers(selected.id).then(setChMembers).catch(()=>{}),0);return()=>clearTimeout(t);},[selected?.id,selected?.isPrivate,manage]);
 async function create(){if(!name.trim())return;try{const c=await api.createChannel(workspaceId,name,isPrivate);setChannels(x=>[...x,c]);setSelected(c);setName("");setIsPrivate(false);setError(null);}catch(e){setError(e instanceof Error?e.message:"Could not create channel");}}
 async function dm(userId:string){try{const c=await api.openDm(workspaceId,userId);setChannels(x=>x.some(y=>y.id===c.id)?x:[...x,c]);setSelected(c);setError(null);}catch(e){setError(e instanceof Error?e.message:"Could not open DM");}}
 async function send(){if(!selected||!body.trim())return;try{
  // A reply threads under the root even when the button was on a reply — one level deep, the server's rule.
  const m=await api.sendMessage(selected.id,body,replyTo?(replyTo.parentId??replyTo.id):undefined);setMessages(x=>[...x,m]);setBody("");setReplyTo(null);setError(null);}catch(e){setError(e instanceof Error?e.message:"Could not send message");}}
 async function addMember(userId:string){if(!selected)return;try{await api.addChannelMember(selected.id,userId);setChMembers(await api.fetchChannelMembers(selected.id));}catch(e){setError(e instanceof Error?e.message:"Could not add member");}}
 async function removeMember(userId:string){if(!selected)return;try{await api.removeChannelMember(selected.id,userId);setChMembers(await api.fetchChannelMembers(selected.id));}catch(e){setError(e instanceof Error?e.message:"Could not remove member");}}
 const others=roster.filter(m=>m.userId!==currentUserId);
 const addable=others.filter(m=>!chMembers.some(cm=>cm.userId===m.userId));
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Chat</DialogTitle><DialogDescription>Workspace channels. Messages poll every five seconds.</DialogDescription></DialogHeader>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<div className="grid min-h-80 grid-cols-[12rem_1fr] gap-3">
  <aside className="grid content-start gap-1 border-r pr-3">
   {channels.map(c=><button key={c.id} className={`flex items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${selected?.id===c.id?"bg-muted font-medium":"hover:bg-muted"}`} onClick={()=>setSelected(c)}><span className="min-w-0 flex-1 truncate">{channelLabel(c)}</span>{c.isPrivate&&!c.name.startsWith("dm:")&&<Lock aria-label="Private" className="size-3 shrink-0 text-muted-foreground"/>}{c.hasUnread&&selected?.id!==c.id&&<span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-primary"/>}</button>)}
   {canEdit&&<div className="mt-2 grid gap-1"><div className="flex gap-1"><Input aria-label="Channel name" value={name} onChange={e=>setName(e.target.value)} placeholder="new-channel"/><Button size="sm" onClick={()=>void create()}>Add</Button></div><label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={isPrivate} onChange={e=>setIsPrivate(e.target.checked)}/> Private</label></div>}
   {canEdit&&others.length>0&&<div className="mt-3 grid gap-1 border-t pt-2"><p className="text-xs font-medium text-muted-foreground">Direct messages</p>{others.map(m=><button key={m.userId} className="rounded px-2 py-1 text-left text-sm hover:bg-muted" onClick={()=>void dm(m.userId)}>{m.name}</button>)}</div>}
  </aside>
  <section className="flex min-w-0 flex-col gap-2">{selected?<>
   {selected.isPrivate&&canEdit&&<div className="flex items-center justify-between text-xs text-muted-foreground"><span className="truncate">{channelLabel(selected)}</span><Button variant="ghost" size="sm" onClick={()=>setManage(v=>!v)}>{manage?"Hide members":"Members"}</Button></div>}
   {selected.isPrivate&&manage&&<div className="rounded border p-2 text-sm"><p className="mb-1 text-xs font-medium text-muted-foreground">Channel members</p><ul className="grid gap-1">{chMembers.map(m=><li key={m.userId} className="flex items-center justify-between gap-2"><span className="truncate">{m.name??"Former member"}</span>{m.userId!==currentUserId&&<Button variant="ghost" size="sm" aria-label={`Remove ${m.name??m.userId}`} onClick={()=>void removeMember(m.userId)}><X/></Button>}</li>)}</ul>{addable.length>0&&<div className="mt-2 flex flex-wrap gap-1">{addable.map(m=><Button key={m.userId} variant="outline" size="sm" onClick={()=>void addMember(m.userId)}>+ {m.name}</Button>)}</div>}</div>}
   <div className="min-h-56 flex-1 space-y-3 overflow-y-auto rounded border p-3">{messages.length?messages.map(m=><article key={m.id} className={m.parentId?"ml-5 border-l pl-3":""}><p className="text-xs text-muted-foreground">{m.authorName??"Former member"} · {new Date(m.createdAt).toLocaleTimeString()}{canEdit&&<button className="ml-2 underline-offset-2 hover:underline" onClick={()=>setReplyTo(m)}>Reply</button>}</p><RichText text={m.body}/></article>):<p className="text-sm text-muted-foreground">No messages yet.</p>}</div>
   {canEdit&&<>{replyTo&&<p className="flex items-center gap-2 text-xs text-muted-foreground">Replying to {replyTo.authorName??"a former member"}: <span className="min-w-0 flex-1 truncate">{replyTo.body}</span><Button variant="ghost" size="sm" aria-label="Cancel reply" onClick={()=>setReplyTo(null)}><X/></Button></p>}<div className="flex gap-2"><Textarea aria-label="Message" value={body} onChange={e=>setBody(e.target.value)} className="min-h-14" placeholder={replyTo?"Write a reply…":"Write a message…"}/><Button size="sm" onClick={()=>void send()}><Send/> Send</Button></div></>}
  </>:<p className="text-sm text-muted-foreground">Create a channel.</p>}</section>
 </div></DialogContent></Dialog>;
}
