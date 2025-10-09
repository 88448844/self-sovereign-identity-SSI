import React, { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Check,
  Copy,
  Rocket,
  Shield,
  Key,
  FileCheck,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  QrCode,
  PlayCircle,
  LockKeyhole,
  Unlock,
} from "lucide-react";
import QRCode from "qrcode.react";

const defaultAttrs = {
  name: "Alice Example",
  dob: "2000-04-10",
  is_student: true,
  over18: true,
};

type DidDoc = {
  did: string;
  public_sign: string;
  public_agree: string;
  service_endpoint: string;
};

const pretty = (x: unknown) => JSON.stringify(x, null, 2);

type ApiOptions = RequestInit & { query?: Record<string, string> };

async function apiFetch(base: string, path: string, opts: ApiOptions = {}) {
  const buildUrl = (prefix: string) => {
    const params = opts.query ? `?${new URLSearchParams(opts.query).toString()}` : "";
    return `${base}${prefix}${path}${params}`;
  };

  const attempt = async (full: string) => {
    const res = await fetch(full, opts);
    return { res, full } as const;
  };

  let { res, full } = await attempt(buildUrl("/v1"));
  if (res.status === 404) {
    const second = await attempt(buildUrl(""));
    res = second.res;
    full = second.full;
  }
  if (!res.ok) {
    let message = "";
    try {
      const data = await res.json();
      message = pretty(data);
    } catch {
      // ignore
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}\n${full}\n${message || "(empty body)"}`);
  }
  return { data: await res.json(), url: full };
}

type IssuerBootstrap = { issuer_did: string; did_doc: DidDoc };
type HolderBootstrap = { holder_did: string; did_doc: DidDoc };
type VerifierBootstrap = { verifier_did: string; did_doc: DidDoc };

type Credential = {
  id: string;
  issuer: string;
  subject: string;
  schema: string;
  attrs: Record<string, unknown>;
  merkle: Record<string, unknown>;
  status: { list_id: string; index: number };
  issued_at: number;
  issuer_signature: string;
};

type PresentationBox = {
  protected: string;
  eph: string;
  nonce: string;
  ct: string;
  tag: string;
};

type VerifyResult = {
  ok: boolean;
  message: string;
  disclosed: Record<string, unknown>;
};

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export default function SsiDemoApp(): JSX.Element {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [issuer, setIssuer] = useState<IssuerBootstrap | null>(null);
  const [holder, setHolder] = useState<HolderBootstrap | null>(null);
  const [verifier, setVerifier] = useState<VerifierBootstrap | null>(null);

  const [attrs, setAttrs] = useState(defaultAttrs);
  const [cred, setCred] = useState<Credential | null>(null);
  const [issuing, setIssuing] = useState(false);

  const [reveal, setReveal] = useState({
    is_student: true,
    over18: true,
    name: false,
    dob: false,
  });
  const [presenting, setPresenting] = useState(false);
  const [jwe, setJwe] = useState<PresentationBox | null>(null);
  const [showQr, setShowQr] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const [revoking, setRevoking] = useState(false);
  const [statuslist, setStatuslist] = useState<Record<string, unknown> | null>(null);
  const [resetting, setResetting] = useState(false);

  const canIssue = issuer && holder;
  const canPresent = holder && verifier && cred;

  const disclosedFields = useMemo(
    () => Object.entries(reveal).filter(([, enabled]) => enabled).map(([key]) => key),
    [reveal],
  );

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const runBootstrap = async () => {
    try {
      const [issuerResp, holderResp, verifierResp] = await Promise.all([
        apiFetch(apiBase, "/bootstrap/issuer", {
          method: "POST",
          headers: { accept: "application/json" },
          query: { name: "Example University" },
        }),
        apiFetch(apiBase, "/bootstrap/holder", {
          method: "POST",
          headers: { accept: "application/json" },
          query: { label: "Alice" },
        }),
        apiFetch(apiBase, "/bootstrap/verifier", {
          method: "POST",
          headers: { accept: "application/json" },
          query: { label: "LibraryVerifier" },
        }),
      ]);
      setIssuer(issuerResp.data as IssuerBootstrap);
      setHolder(holderResp.data as HolderBootstrap);
      setVerifier(verifierResp.data as VerifierBootstrap);
      toast.success("Bootstrapped issuer, holder, verifier");
    } catch (error) {
      console.error(error);
      toast.error("Bootstrap failed. Check console for details.");
    }
  };

  const runIssue = async () => {
    if (!canIssue || !holder) {
      return;
    }
    setIssuing(true);
    try {
      const idemKey = globalThis.crypto?.randomUUID?.() ?? `idem-${Date.now()}`;
      const { data } = await apiFetch(apiBase, "/issuer/issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "Idempotency-Key": idemKey,
        },
        body: JSON.stringify({
          subject_did: holder.holder_did,
          attributes: {
            name: attrs.name,
            dob: attrs.dob,
            is_student: !!attrs.is_student,
            over18: !!attrs.over18,
          },
        }),
      });
      setCred(data as Credential);
      toast.success("Credential issued");
    } catch (error) {
      console.error(error);
      toast.error("Issuance failed");
    } finally {
      setIssuing(false);
    }
  };

  const runPresent = async () => {
    if (!holder || !verifier || !cred) {
      return;
    }
    setPresenting(true);
    try {
      const { data } = await apiFetch(apiBase, "/holder/present", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          holder_did: holder.holder_did,
          cred_id: cred.id,
          reveal_fields: disclosedFields,
          verifier_did: verifier.verifier_did,
        }),
      });
      const box = (data.box ?? data) as PresentationBox;
      setJwe(box);
      setVerifyResult(null);
      toast.success("Presentation packaged");
    } catch (error) {
      console.error(error);
      toast.error("Presentation failed");
    } finally {
      setPresenting(false);
    }
  };

  const runVerify = async () => {
    if (!jwe) {
      return;
    }
    setVerifying(true);
    try {
      const payload: Record<string, string> = {
        protected: jwe.protected,
        eph: jwe.eph,
        nonce: jwe.nonce,
        ct: jwe.ct,
        tag: jwe.tag,
      };
      const { data } = await apiFetch(apiBase, "/verifier/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      setVerifyResult(data as VerifyResult);
      toast.success((data as VerifyResult).ok ? "Verified ✅" : "Verification failed ❌");
    } catch (error) {
      console.error(error);
      toast.error("Verification error");
    } finally {
      setVerifying(false);
    }
  };

  const runRevoke = async () => {
    if (!cred) {
      return;
    }
    setRevoking(true);
    try {
      await apiFetch(apiBase, "/issuer/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({ cred_id: cred.id }),
      });
      toast.success("Credential revoked");
      if (cred.status?.list_id) {
        const { data } = await apiFetch(
          apiBase,
          `/issuer/statuslist/${encodeURIComponent(cred.status.list_id)}`,
          { method: "GET", headers: { accept: "application/json" } },
        );
        setStatuslist(data as Record<string, unknown>);
      }
    } catch (error) {
      console.error(error);
      toast.error("Revoke failed");
    } finally {
      setRevoking(false);
    }
  };

  const runLifecycle = async () => {
    await runBootstrap();
    await runIssue();
    await runPresent();
    await runVerify();
  };

  const runReset = async () => {
    setResetting(true);
    try {
      await apiFetch(apiBase, "/admin/reset", {
        method: "POST",
        headers: { accept: "application/json" },
      });
      setIssuer(null);
      setHolder(null);
      setVerifier(null);
      setCred(null);
      setJwe(null);
      setVerifyResult(null);
      setStatuslist(null);
      setAttrs({ ...defaultAttrs });
      setReveal({
        is_student: true,
        over18: true,
        name: false,
        dob: false,
      });
      setShowQr(false);
      setIssuing(false);
      setPresenting(false);
      setVerifying(false);
      setRevoking(false);
      toast.success("Demo state reset");
    } catch (error) {
      console.error(error);
      toast.error("Reset failed");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-white text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">SSI Reference Demo</h1>
            <p className="text-slate-600">
              Selective disclosure credentials: Bootstrap → Issue → Present → Verify → Revoke
            </p>
          </div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <div className="flex items-center gap-2">
              <Input
                value={apiBase}
                onChange={(event) => setApiBase(event.target.value)}
                className="w-72"
                placeholder="API base URL"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => toast(`API base set to ${apiBase}`)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Use API
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" onClick={runLifecycle}>
                <PlayCircle className="mr-2 h-4 w-4" />
                Run full flow
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={resetting}
                onClick={runReset}
              >
                {resetting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {resetting ? "Resetting…" : "Reset state"}
              </Button>
            </div>
          </div>
        </header>

        <Tabs defaultValue="bootstrap">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="bootstrap">Bootstrap</TabsTrigger>
            <TabsTrigger value="issue">Issue</TabsTrigger>
            <TabsTrigger value="present">Present</TabsTrigger>
            <TabsTrigger value="verify">Verify</TabsTrigger>
            <TabsTrigger value="revoke">Revoke</TabsTrigger>
          </TabsList>

          <TabsContent value="bootstrap">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Rocket className="h-5 w-5" />
                    Issuer
                  </CardTitle>
                  <CardDescription>Create DID + keys for the issuer</CardDescription>
                </CardHeader>
                <CardContent>
                  {issuer ? (
                    <JsonBlock
                      title="Issuer"
                      data={issuer}
                      onCopy={() => copy(issuer.issuer_did)}
                    />
                  ) : (
                    <DisabledNote />
                  )}
                </CardContent>
                <CardFooter>
                  <Button className="w-full" onClick={runBootstrap}>
                    <Rocket className="mr-2 h-4 w-4" />
                    Bootstrap all
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <Key className="h-5 w-5" />
                    Holder
                  </CardTitle>
                  <CardDescription>Create DID + keys for the holder</CardDescription>
                </CardHeader>
                <CardContent>
                  {holder ? (
                    <JsonBlock
                      title="Holder"
                      data={holder}
                      onCopy={() => copy(holder.holder_did)}
                    />
                  ) : (
                    <DisabledNote />
                  )}
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full" onClick={runBootstrap}>
                    Re-run Bootstrap
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <Shield className="h-5 w-5" />
                    Verifier
                  </CardTitle>
                  <CardDescription>Create DID + keys for the verifier</CardDescription>
                </CardHeader>
                <CardContent>
                  {verifier ? (
                    <JsonBlock
                      title="Verifier"
                      data={verifier}
                      onCopy={() => copy(verifier.verifier_did)}
                    />
                  ) : (
                    <DisabledNote />
                  )}
                </CardContent>
                <CardFooter className="flex items-center justify-between">
                  <Badge variant="secondary">Keys on server</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setIssuer(null);
                      setHolder(null);
                      setVerifier(null);
                      setCred(null);
                      setJwe(null);
                      setVerifyResult(null);
                      setStatuslist(null);
                      toast("Cleared bootstrapped state");
                    }}
                    aria-label="Clear state"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="issue">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <FileCheck className="h-5 w-5" />
                    Issue Credential
                  </CardTitle>
                  <CardDescription>Creates signed credential with Merkle commitment</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Subject (Holder DID)</Label>
                      <Input disabled value={holder?.holder_did ?? "—"} />
                    </div>
                    <div>
                      <Label>Issuer DID</Label>
                      <Input disabled value={issuer?.issuer_did ?? "—"} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Name</Label>
                      <Input
                        value={attrs.name as string}
                        onChange={(event) => setAttrs((current) => ({ ...current, name: event.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>Date of birth</Label>
                      <Input
                        type="date"
                        value={attrs.dob as string}
                        onChange={(event) => setAttrs((current) => ({ ...current, dob: event.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!!attrs.is_student}
                        onCheckedChange={(value) => setAttrs((current) => ({ ...current, is_student: value }))}
                      />
                      <Label className="cursor-pointer">is_student</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!!attrs.over18}
                        onCheckedChange={(value) => setAttrs((current) => ({ ...current, over18: value }))}
                      />
                      <Label className="cursor-pointer">over18</Label>
                    </div>
                  </div>
                  <div>
                    <Label>Raw attributes (read only preview)</Label>
                    <Textarea
                      readOnly
                      value={pretty({
                        name: attrs.name,
                        dob: attrs.dob,
                        is_student: !!attrs.is_student,
                        over18: !!attrs.over18,
                      })}
                      className="font-mono text-xs"
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    disabled={!canIssue || issuing}
                    onClick={runIssue}
                  >
                    {issuing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    {issuing ? "Issuing…" : "Issue"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Issued credential</CardTitle>
                  <CardDescription>Server response (signature, status slot)</CardDescription>
                </CardHeader>
                <CardContent>
                  {cred ? (
                    <JsonBlock title="Credential" data={cred} onCopy={() => copy(cred.id)} />
                  ) : (
                    <DisabledNote text="Issue a credential to view the payload." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="present">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <LockKeyhole className="h-5 w-5" />
                    Selective disclosure
                  </CardTitle>
                  <CardDescription>Choose which fields to reveal</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    {Object.entries(reveal).map(([key, enabled]) => (
                      <div key={key} className="flex items-center gap-2">
                        <Switch
                          checked={enabled}
                          onCheckedChange={(value) => setReveal((current) => ({ ...current, [key]: value }))}
                        />
                        <Label className="cursor-pointer">{key}</Label>
                      </div>
                    ))}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" disabled={!canPresent || presenting} onClick={runPresent}>
                    {presenting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="mr-2 h-4 w-4" />
                    )}
                    {presenting ? "Packaging…" : "Present"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>JWE package</CardTitle>
                  <CardDescription>Encrypted bundle for the verifier</CardDescription>
                </CardHeader>
                <CardContent>
                  {jwe ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => copy(pretty(jwe))}>
                          <Copy className="mr-2 h-4 w-4" />
                          Copy JSON
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setShowQr((value) => !value)}>
                          {showQr ? <EyeOff className="mr-2 h-4 w-4" /> : <QrCode className="mr-2 h-4 w-4" />}
                          {showQr ? "Hide QR" : "Show QR"}
                        </Button>
                      </div>
                      {showQr && (
                        <div className="flex justify-center">
                          <QRCode
                            value={JSON.stringify({
                              p: jwe.protected,
                              e: jwe.eph,
                              n: jwe.nonce,
                              c: jwe.ct,
                              t: jwe.tag,
                            })}
                            size={180}
                            includeMargin
                          />
                        </div>
                      )}
                      <JsonBlock data={jwe} compact />
                    </div>
                  ) : (
                    <DisabledNote text="Create a presentation to view the encrypted payload." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="verify">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Shield className="h-5 w-5" />
                    Send to verifier
                  </CardTitle>
                  <CardDescription>POST /verifier/verify with JWE parts</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600">
                    Verifier DID: {verifier?.verifier_did ?? "—"}
                  </p>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" disabled={!jwe || verifying} onClick={runVerify}>
                    {verifying ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    {verifying ? "Verifying…" : "Verify"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Verification result</CardTitle>
                  <CardDescription>Disclosed claims after validation</CardDescription>
                </CardHeader>
                <CardContent>
                  {verifyResult ? (
                    <div className="space-y-3">
                      {verifyResult.ok ? (
                        <Badge className="bg-emerald-500 hover:bg-emerald-500">Verified</Badge>
                      ) : (
                        <Badge variant="destructive">Failed</Badge>
                      )}
                      <JsonBlock data={verifyResult} />
                    </div>
                  ) : (
                    <DisabledNote text="Run verify to view the response." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="revoke">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Unlock className="h-5 w-5" />
                    Revoke credential
                  </CardTitle>
                  <CardDescription>Flips status bit; future verifications fail</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600">Credential: {cred?.id ?? "—"}</p>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" disabled={!cred || revoking} onClick={runRevoke}>
                    {revoking ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    {revoking ? "Revoking…" : "Revoke"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Status list</CardTitle>
                  <CardDescription>Most recent published bitset</CardDescription>
                </CardHeader>
                <CardContent>
                  {statuslist ? (
                    <JsonBlock data={statuslist} />
                  ) : (
                    <DisabledNote text="Revoke to fetch the status list." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <footer className="mt-10 flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <div>
            API:
            <code className="ml-2 rounded bg-slate-100 px-2 py-1">{apiBase}</code>
          </div>
          <div className="flex items-center gap-4">
            <a
              className="underline decoration-slate-400 underline-offset-2 hover:text-slate-900"
              href={`${apiBase}/docs`}
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI /docs
            </a>
            <a
              className="underline decoration-slate-400 underline-offset-2 hover:text-slate-900"
              href={`${apiBase}/healthz`}
              target="_blank"
              rel="noreferrer"
            >
              /healthz
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

function JsonBlock({
  title,
  data,
  compact = false,
  onCopy,
}: {
  title?: string;
  data: unknown;
  compact?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-inner">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {title && <span className="text-sm font-semibold text-slate-700">{title}</span>}
          <Badge variant="secondary">JSON</Badge>
        </div>
        {onCopy && (
          <Button size="sm" variant="outline" onClick={onCopy}>
            <Copy className="mr-2 h-4 w-4" />
            Copy key
          </Button>
        )}
      </div>
      <pre
        className={`max-h-72 overflow-auto rounded-lg bg-white p-3 font-mono text-xs leading-relaxed ${
          compact ? "max-h-56" : ""
        }`}
      >
        {pretty(data)}
      </pre>
    </div>
  );
}

function DisabledNote({ text = "Run the previous step to populate this panel." }: { text?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      {text}
    </div>
  );
}
