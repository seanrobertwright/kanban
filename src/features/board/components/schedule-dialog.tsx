"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { applyScheduleProposal, fetchScheduleProposal } from "../client/api";
import type { ScheduleProposal } from "../lib/schedule-proposal";
export function ScheduleDialog({boardId,open,onOpenChange,onApplied}:{boardId:number;open:boolean;onOpenChange:(open:boolean)=>void;onApplied:()=>void}) {
 const [rows,setRows]=useState<ScheduleProposal[]|null>(null); const [error,setError]=useState<string|null>(null); const [saving,setSaving]=useState(false);
 useEffect(()=>{if(!open)return; setRows(null);setError(null); void fetchScheduleProposal(boardId).then(setRows).catch(e=>setError(e instanceof Error?e.message:"Could not propose schedule"));},[open,boardId]);
 async function apply(){if(!rows)return;setSaving(true);try{await applyScheduleProposal(boardId,rows);onApplied();onOpenChange(false);}catch(e){setError(e instanceof Error?e.message:"Could not apply schedule");}finally{setSaving(false);}}
 return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Proposed schedule</DialogTitle><DialogDescription>Dependency-aware dates are a proposal. Review them, then explicitly apply them to the board.</DialogDescription></DialogHeader>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{!rows&&!error&&<p className="text-sm text-muted-foreground">Planning…</p>}{rows&&<><div className="max-h-80 space-y-2 overflow-y-auto">{rows.map(r=><div key={r.taskId} className="rounded border p-2 text-xs"><p className="font-medium">#{r.taskId} · {r.startDate} → {r.dueDate}</p><p className="text-muted-foreground">{r.reasons.join(" · ")}</p></div>)}</div><Button disabled={saving||rows.length===0} onClick={()=>void apply()}>{saving?"Applying…":"Apply reviewed schedule"}</Button></>}</DialogContent></Dialog>;
}
