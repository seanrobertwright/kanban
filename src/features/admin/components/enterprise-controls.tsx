"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorkspaceMembership } from "@/features/workspaces/types";
import * as api from "@/features/workspaces/client/api";
import type { DiscoveryHit, IdentityProvider, LegalHold, RetentionPolicy } from "../types";
import type { IntegrationConnection } from "@/features/integrations/types";
import type { WorkspaceExtension } from "@/features/extensions/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Select, SelectItem } from "@/shared/ui/select";

const retentionSubjects: RetentionPolicy["subjectType"][] = ["activity_log", "task", "comment", "attachment", "doc"];
const holdSubjects: LegalHold["subjectType"][] = ["task", "comment", "attachment", "doc"];

/** The compliance and identity surfaces kept separate from the small dashboard
 * shell so each operation refreshes its own data and a failed action is visible. */
export function EnterpriseControls({ workspace }: { workspace: WorkspaceMembership }) {
  const owner = workspace.role === "owner";
  const [retention, setRetention] = useState<RetentionPolicy[]>([]);
  const [holds, setHolds] = useState<LegalHold[]>([]);
  const [providers, setProviders] = useState<IdentityProvider[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);
  const [extensions, setExtensions] = useState<WorkspaceExtension[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retentionSubject, setRetentionSubject] = useState<RetentionPolicy["subjectType"]>("activity_log");
  const [days, setDays] = useState("365");
  const [holdSubject, setHoldSubject] = useState<LegalHold["subjectType"]>("task");
  const [holdId, setHoldId] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<DiscoveryHit[]>([]);
  const [protocol, setProtocol] = useState<"oidc" | "saml">("oidc");
  const [providerId, setProviderId] = useState("");
  const [issuer, setIssuer] = useState("");
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [certificate, setCertificate] = useState("");
  const [scimToken, setScimToken] = useState<string | null>(null);
  const [teamsChannelId, setTeamsChannelId] = useState("");
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState("");
  const [teamsName, setTeamsName] = useState("");
  const [extensionManifest, setExtensionManifest] = useState('{"name":"","url":"https://","capabilities":["task.read"],"slots":["task_panel"]}');

  async function load() {
    const [nextRetention, nextHolds, nextProviders, nextIntegrations, nextExtensions] = await Promise.all([
      api.fetchRetentionPolicies(workspace.id),
      api.fetchLegalHolds(workspace.id),
      api.fetchIdentityProviders(workspace.id),
      api.fetchIntegrations(workspace.id),
      api.fetchExtensions(workspace.id),
    ]);
    setRetention(nextRetention); setHolds(nextHolds); setProviders(nextProviders); setIntegrations(nextIntegrations); setExtensions(nextExtensions);
  }
  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load enterprise settings")); }, [workspace.id]);
  async function run(operation: () => Promise<void>) { setBusy(true); setError(null); try { await operation(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); } finally { setBusy(false); } }
  const exportUrl = `/api/workspaces/${workspace.id}/ediscovery?q=${encodeURIComponent(search)}`;

  return <div className="grid gap-4 border-t pt-3">
    <section className="grid gap-2"><h3 className="text-sm font-medium">Retention</h3><p className="text-xs text-muted-foreground">The scheduled sweep applies activity-log policies. Holds block deletion of tasks, comments, attachments, and documents.</p>{owner && <div className="flex flex-wrap gap-2"><Select aria-label="Retention record type" value={retentionSubject} onValueChange={value => setRetentionSubject(value as RetentionPolicy["subjectType"])}>{retentionSubjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</Select><Input aria-label="Retention days" className="w-28" type="number" min="1" value={days} onChange={e => setDays(e.target.value)} /><Button size="sm" disabled={busy || !days} onClick={() => void run(async () => { const maxAgeDays = Number(days); if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) throw new Error("Retention days must be a positive integer"); await api.saveRetentionPolicy(workspace.id, retentionSubject, maxAgeDays); })}>Save</Button></div>}<div className="grid gap-1 text-xs">{retention.map(p => <p key={p.id}>{p.subjectType}: {p.maxAgeDays} days</p>)}</div></section>
    <section className="grid gap-2"><h3 className="text-sm font-medium">Legal holds</h3>{owner && <div className="flex flex-wrap gap-2"><Select aria-label="Hold record type" value={holdSubject} onValueChange={value => setHoldSubject(value as LegalHold["subjectType"])}>{holdSubjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</Select><Input aria-label="Record id" className="w-24" value={holdId} onChange={e => setHoldId(e.target.value)} placeholder="ID" /><Input aria-label="Hold reason" value={holdReason} onChange={e => setHoldReason(e.target.value)} placeholder="Reason" /><Button size="sm" disabled={busy || !holdId || !holdReason} onClick={() => void run(async () => { await api.placeLegalHold(workspace.id, holdSubject, holdId, holdReason); setHoldId(""); setHoldReason(""); })}>Hold</Button></div>}<div className="grid gap-1 text-xs">{holds.map(h => <div className="flex gap-2" key={h.id}><span className="flex-1">{h.subjectType} #{h.subjectId}: {h.reason}</span>{owner && <Button variant="ghost" size="icon" className="size-6" aria-label="Release legal hold" disabled={busy} onClick={() => void run(() => api.releaseLegalHold(workspace.id, h.id))}><Trash2 /></Button>}</div>)}</div></section>
    <section className="grid gap-2"><h3 className="text-sm font-medium">eDiscovery</h3><div className="flex gap-2"><Input aria-label="Search workspace records" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tasks, comments, docs, audit" /><Button size="sm" disabled={busy || !search.trim()} onClick={() => void run(async () => setHits(await api.searchDiscovery(workspace.id, search)))}>Search</Button><Button size="sm" variant="outline" disabled={!search.trim()} onClick={() => window.location.assign(exportUrl)}>Export JSON</Button></div><div className="grid gap-1 text-xs">{hits.slice(0, 10).map(hit => <p key={`${hit.subjectType}-${hit.id}`}>{hit.subjectType} #{hit.id}: {hit.title}</p>)}</div></section>
    <section className="grid gap-2"><h3 className="text-sm font-medium">Identity providers</h3><p className="text-xs text-muted-foreground">Owners configure OIDC or SAML. Generated SCIM tokens are shown once.</p>{owner && <div className="grid gap-2"><div className="flex gap-2"><Select aria-label="Identity protocol" value={protocol} onValueChange={value => setProtocol(value as "oidc" | "saml")}><SelectItem value="oidc">OIDC</SelectItem><SelectItem value="saml">SAML</SelectItem></Select><Input aria-label="Provider id" value={providerId} onChange={e => setProviderId(e.target.value)} placeholder="Provider ID" /><Input aria-label="Identity issuer" value={issuer} onChange={e => setIssuer(e.target.value)} placeholder="Issuer URL" /><Input aria-label="Identity domain" value={domain} onChange={e => setDomain(e.target.value)} placeholder="company.com" /></div>{protocol === "oidc" ? <div className="flex gap-2"><Input aria-label="OIDC client id" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Client ID" /><Input aria-label="OIDC client secret" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="Client secret" /><Input aria-label="OIDC discovery endpoint" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="Discovery URL" /></div> : <div className="flex gap-2"><Input aria-label="SAML entry point" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="IdP entry point" /><Input aria-label="SAML certificate" value={certificate} onChange={e => setCertificate(e.target.value)} placeholder="Signing certificate" /><Input aria-label="SAML callback URL" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Callback URL" /></div>}<Button size="sm" disabled={busy || !providerId || !issuer || !domain || !endpoint || (protocol === "oidc" && (!clientId || !clientSecret)) || (protocol === "saml" && (!clientId || !certificate))} onClick={() => void run(async () => { const input: Record<string, unknown> = { providerId, issuer, domain }; if (protocol === "oidc") input.oidcConfig = { clientId, clientSecret, discoveryEndpoint: endpoint, pkce: true }; else input.samlConfig = { entryPoint: endpoint, cert: certificate, callbackUrl: clientId }; await api.registerIdentityProvider(workspace.id, input); setProviderId(""); setIssuer(""); setDomain(""); setClientId(""); setClientSecret(""); setEndpoint(""); setCertificate(""); })}>Add provider</Button></div>}<div className="grid gap-1 text-xs">{providers.map(provider => <div className="flex flex-wrap gap-2" key={provider.providerId}><span className="flex-1">{provider.providerId} ({provider.protocol}) — {provider.domain}</span>{owner && <><Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => setScimToken((await api.generateScimToken(workspace.id, provider.providerId)).scimToken))}>SCIM token</Button><Button variant="ghost" size="icon" className="size-6" aria-label="Remove identity provider" disabled={busy} onClick={() => void run(() => api.removeIdentityProvider(workspace.id, provider.providerId))}><Trash2 /></Button></>}</div>)}</div>{scimToken && <p className="break-all rounded border p-2 text-xs" role="status">Copy this SCIM token now: {scimToken}</p>}</section>
    <section className="grid gap-2"><h3 className="text-sm font-medium">Work integrations</h3><p className="text-xs text-muted-foreground">Slack, Google Workspace, and Microsoft 365 use OAuth. Teams outgoing webhooks are encrypted at rest; map the channel ID to receive signed bot “create …” messages.</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => window.location.assign(`/api/workspaces/${workspace.id}/integrations/slack/install`)}>Connect Slack</Button><Button size="sm" variant="outline" onClick={() => window.location.assign(`/api/workspaces/${workspace.id}/integrations/google/install`)}>Connect Google Workspace</Button><Button size="sm" variant="outline" onClick={() => window.location.assign(`/api/workspaces/${workspace.id}/integrations/microsoft/install`)}>Connect Microsoft 365</Button></div><div className="grid gap-2"><div className="flex flex-wrap gap-2"><Input aria-label="Teams channel id" value={teamsChannelId} onChange={e => setTeamsChannelId(e.target.value)} placeholder="Teams channel / conversation ID" /><Input aria-label="Teams webhook URL" type="url" value={teamsWebhookUrl} onChange={e => setTeamsWebhookUrl(e.target.value)} placeholder="https://…webhook.office.com/…" /><Input aria-label="Teams connection name" value={teamsName} onChange={e => setTeamsName(e.target.value)} placeholder="Name (optional)" /><Button size="sm" disabled={busy || !teamsChannelId.trim() || !teamsWebhookUrl.trim()} onClick={() => void run(async () => { await api.addTeamsWebhook(workspace.id, { channelId: teamsChannelId, webhookUrl: teamsWebhookUrl, name: teamsName || undefined }); setTeamsChannelId(""); setTeamsWebhookUrl(""); setTeamsName(""); })}>Connect Teams</Button></div></div><div className="grid gap-1 text-xs">{integrations.length === 0 ? <p className="text-muted-foreground">No integrations connected.</p> : integrations.map(connection => <div key={connection.id} className="flex gap-2"><span className="flex-1">{connection.provider}: {String(connection.metadata.name ?? connection.metadata.teamName ?? connection.metadata.email ?? connection.externalId)}</span><Button variant="ghost" size="icon" className="size-6" aria-label={`Remove ${connection.provider} integration`} disabled={busy} onClick={() => void run(() => api.removeIntegration(workspace.id, connection.id))}><Trash2 /></Button></div>)}</div></section>
    <section className="grid gap-2"><h3 className="text-sm font-medium">Extensions</h3><p className="text-xs text-muted-foreground">Owners install HTTPS manifests. Task panels run in sandboxed iframes and receive only the capabilities explicitly granted.</p>{owner && <div className="grid gap-2"><textarea aria-label="Extension manifest" className="min-h-24 rounded-md border bg-transparent p-2 font-mono text-xs" value={extensionManifest} onChange={e => setExtensionManifest(e.target.value)} /><Button size="sm" disabled={busy} onClick={() => void run(async () => { let manifest: unknown; try { manifest = JSON.parse(extensionManifest); } catch { throw new Error("Extension manifest must be valid JSON"); } await api.installExtension(workspace.id, manifest as import("@/features/extensions/types").ExtensionManifest); })}>Install extension</Button></div>}<div className="grid gap-1 text-xs">{extensions.length === 0 ? <p className="text-muted-foreground">No extensions installed.</p> : extensions.map(extension => <div className="flex gap-2" key={extension.id}><span className="flex-1">{extension.name} — {extension.slots.join(", ")}</span>{owner && <Button variant="ghost" size="icon" className="size-6" aria-label={`Remove ${extension.name}`} disabled={busy} onClick={() => void run(() => api.removeExtension(workspace.id, extension.id))}><Trash2 /></Button>}</div>)}</div></section>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
