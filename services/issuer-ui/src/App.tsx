import React, { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@kit";
import { toast } from "sonner";
import {
  BadgeCheck,
  Check,
  Copy,
  FileCheck2,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldPlus,
  Trash2,
  Zap,
} from "lucide-react";
import QRCode from "qrcode.react";

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const STORAGE_KEY_BASE = "issuer-ui::api-base";
const STORAGE_KEY_TOKEN = "issuer-ui::admin-token";

const defaultIssuerName = "Example University";
const defaultAttributes = {
  name: "Alice Example",
  dob: "2000-04-10",
  is_student: true,
  over18: true,
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const canonicalDid = (did?: string) => {
  if (!did) return "—";
  const parts = did.split(":");
  return parts[parts.length - 1];
};
const randomKey = () => crypto?.randomUUID?.() ?? `idem-${Date.now()}`;

type DidDoc = {
  did: string;
  public_sign: string;
  public_agree: string;
  service_endpoint: string;
};

type IssuerBootstrap = {
  issuer_did: string;
  did_doc: DidDoc;
};

type CredentialRecord = {
  id: string;
  issuer: string;
  subject: string;
  schema: string;
  attrs: Record<string, unknown>;
  status: { list_id: string; index: number };
  issued_at: number;
  issuer_signature: string;
  idem_key: string;
};

type ApiOptions = RequestInit & {
  query?: Record<string, string>;
};

const initialIssueAttributes = JSON.stringify(defaultAttributes, null, 2);

export default function App(): JSX.Element {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [adminToken, setAdminToken] = useState("");
  const [issuerName, setIssuerName] = useState(defaultIssuerName);
  const [issuer, setIssuer] = useState<IssuerBootstrap | null>(null);
  const [issueSubjectDid, setIssueSubjectDid] = useState("");
  const [issueAttributes, setIssueAttributes] = useState(initialIssueAttributes);
  const [issueIdemKey, setIssueIdemKey] = useState(randomKey());
  const [issuedCredentials, setIssuedCredentials] = useState<CredentialRecord[]>([]);
  const [statusList, setStatusList] = useState<Record<string, unknown> | null>(null);
  const [revokeTarget, setRevokeTarget] = useState("");
  const [statusListId, setStatusListId] = useState("");
  const [offerChallenge, setOfferChallenge] = useState(randomKey());
  const [offer, setOffer] = useState<Record<string, unknown> | null>(null);
  const [isBootstrapLoading, setBootstrapLoading] = useState(false);
  const [isIssueLoading, setIssueLoading] = useState(false);
  const [isRevokeLoading, setRevokeLoading] = useState(false);
  const [isStatusLoading, setStatusLoading] = useState(false);
  const [isResetting, setResetting] = useState(false);
  const [isOfferLoading, setOfferLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedBase = window.localStorage.getItem(STORAGE_KEY_BASE);
    const storedToken = window.localStorage.getItem(STORAGE_KEY_TOKEN);
    if (storedBase) setApiBase(storedBase);
    if (storedToken) setAdminToken(storedToken);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY_BASE, apiBase);
  }, [apiBase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY_TOKEN, adminToken);
  }, [adminToken]);

  const attributeKeys = useMemo(() => {
    try {
      const parsed = JSON.parse(issueAttributes) as Record<string, unknown>;
      return Object.keys(parsed);
    } catch {
      return Object.keys(defaultAttributes);
    }
  }, [issueAttributes]);

  const [selectedClaims, setSelectedClaims] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const key of Object.keys(defaultAttributes)) {
      initial[key] = true;
    }
    return initial;
  });

  useEffect(() => {
    setSelectedClaims((previous) => {
      const next: Record<string, boolean> = {};
      for (const key of attributeKeys) {
        next[key] = previous[key] ?? true;
      }
      return next;
    });
  }, [attributeKeys]);

  const apiFetch = async (path: string, options: ApiOptions = {}) => {
    const { query, ...init } = options;
    const urlWith = (prefix: string) => {
      const params = query ? `?${new URLSearchParams(query).toString()}` : "";
      return `${apiBase}${prefix}${path}${params}`;
    };

    const headers = new Headers(init.headers ?? {});
    if (adminToken) {
      headers.set("X-Admin-Token", adminToken);
    }
    const request: RequestInit = {
      ...init,
      headers,
    };

    const attempt = async (url: string) => {
      const response = await fetch(url, request);
      return { response, url } as const;
    };

    let { response, url } = await attempt(urlWith("/v1"));
    if (response.status === 404) {
      const retry = await attempt(urlWith(""));
      response = retry.response;
      url = retry.url;
    }

    if (!response.ok) {
      let body = "";
      try {
        body = pretty(await response.json());
      } catch {
        // ignore json parse
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}\n${url}\n${body || "(empty body)"}`);
    }
    return response.json();
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch (error) {
      console.error(error);
      toast.error("Unable to copy to clipboard");
    }
  };

  const resetStateLocally = () => {
    setIssuer(null);
    setIssuedCredentials([]);
    setStatusList(null);
    setRevokeTarget("");
    setStatusListId("");
    setOffer(null);
    setOfferChallenge(randomKey());
    setIssueIdemKey(randomKey());
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await apiFetch("/admin/reset", { method: "POST" });
      resetStateLocally();
      toast.success("Environment reset");
    } catch (error) {
      console.error(error);
      toast.error("Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const handleBootstrap = async () => {
    setBootstrapLoading(true);
    try {
      const data = (await apiFetch("/bootstrap/issuer", {
        method: "POST",
        query: { name: issuerName || "Issuer" },
      })) as IssuerBootstrap;
      setIssuer(data);
      toast.success("Issuer ready");
    } catch (error) {
      console.error(error);
      toast.error("Bootstrap failed");
    } finally {
      setBootstrapLoading(false);
    }
  };

  const handleIssue = async () => {
    if (!issueSubjectDid.trim()) {
      toast.error("Subject DID required");
      return;
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(issueAttributes) as Record<string, unknown>;
    } catch (error) {
      toast.error("Attributes must be valid JSON");
      console.error(error);
      return;
    }

    setIssueLoading(true);
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
      "Idempotency-Key": issueIdemKey,
    };

    try {
      const credential = (await apiFetch("/issuer/issue", {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject_did: issueSubjectDid.trim(),
          attributes: payload,
        }),
      })) as CredentialRecord;
      const record: CredentialRecord = {
        ...credential,
        idem_key: issueIdemKey,
      };
      setIssuedCredentials((prev) => [record, ...prev]);
      setStatusListId(record.status.list_id);
      setRevokeTarget(record.id);
      setIssueIdemKey(randomKey());
      toast.success("Credential issued");
    } catch (error) {
      console.error(error);
      toast.error("Issuance failed");
    } finally {
      setIssueLoading(false);
    }
  };

  const handleFetchStatus = async () => {
    if (!statusListId) {
      toast.error("Issue a credential first to obtain a status list");
      return;
    }
    setStatusLoading(true);
    try {
      const data = (await apiFetch(`/issuer/statuslist/${encodeURIComponent(statusListId)}`)) as Record<string, unknown>;
      setStatusList(data);
      toast.success("Status list refreshed");
    } catch (error) {
      console.error(error);
      toast.error("Unable to fetch status list");
    } finally {
      setStatusLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget.trim()) {
      toast.error("Credential id required");
      return;
    }
    setRevokeLoading(true);
    try {
      await apiFetch("/issuer/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ cred_id: revokeTarget.trim() }),
      });
      toast.success("Credential revoked");
      await handleFetchStatus();
    } catch (error) {
      console.error(error);
      toast.error("Revocation failed");
    } finally {
      setRevokeLoading(false);
    }
  };

  const handleGenerateOffer = async () => {
    if (!issuer) {
      toast.error("Bootstrap the issuer first");
      return;
    }
    const normalizedChallenge = offerChallenge.trim() || randomKey();
    if (!offerChallenge.trim()) {
      setOfferChallenge(normalizedChallenge);
    }
    if (!Object.values(selectedClaims).some(Boolean)) {
      toast.error("Select at least one claim to request");
      return;
    }
    setOfferLoading(true);
    try {
      const claims: Record<string, boolean> = {};
      for (const key of attributeKeys) {
        if (selectedClaims[key]) {
          claims[key] = true;
        }
      }
      const result = (await apiFetch("/issuer/offers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          challenge: normalizedChallenge,
          issuer_did: issuer.issuer_did,
          claims,
        }),
      })) as { ok: boolean; challenge: string; ttl_seconds: number };
      if (!result.ok) {
        throw new Error("issuer/offers returned failure");
      }
      const envelope = {
        type: "issuance-init",
        api: apiBase,
        issuer_did: issuer.issuer_did,
        claims,
        challenge: result.challenge,
        issued_at: Date.now(),
        ttl_seconds: result.ttl_seconds,
      };
      setOffer(envelope);
      toast.success(`Issuance offer ready (expires in ${result.ttl_seconds} seconds)`);
    } catch (error) {
      console.error(error);
      toast.error("Could not generate offer");
    } finally {
      setOfferLoading(false);
    }
  };

  const activeClaimsCount = useMemo(
    () => Object.values(selectedClaims).filter(Boolean).length,
    [selectedClaims],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-white text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Issuer Operations Portal</h1>
            <p className="text-slate-600">
              Manage issuer keys, issue credentials, publish status lists, and prepare QR-based
              issuance offers.
            </p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <Input
                value={apiBase}
                onChange={(event) => setApiBase(event.target.value)}
                className="w-72"
                placeholder="API base URL"
              />
              <Input
                type="password"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                className="w-56"
                placeholder="Admin token"
              />
              <Button
                variant="outline"
                onClick={() => toast(`Using ${apiBase}`)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Update
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isResetting}
            >
              {isResetting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {isResetting ? "Resetting…" : "Reset demo state"}
            </Button>
          </div>
        </header>

        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="issue">Issue</TabsTrigger>
            <TabsTrigger value="revocation">Revocation & Status</TabsTrigger>
            <TabsTrigger value="offer">Issuance Offer</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Rocket className="h-5 w-5" />
                    Bootstrap Issuer
                  </CardTitle>
                  <CardDescription>
                    Provision signing + agreement keys and publish the DID document.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="issuerName">Issuer display name</Label>
                    <Input
                      id="issuerName"
                      value={issuerName}
                      onChange={(event) => setIssuerName(event.target.value)}
                    />
                  </div>
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm text-slate-600">
                      Current DID:
                      <span className="ml-2 font-mono text-slate-900">
                        {issuer ? canonicalDid(issuer.issuer_did) : "—"}
                      </span>
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between">
                  <Button onClick={handleBootstrap} disabled={isBootstrapLoading} className="w-full">
                    {isBootstrapLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldPlus className="mr-2 h-4 w-4" />
                    )}
                    {isBootstrapLoading ? "Bootstrapping…" : "Bootstrap issuer"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <BadgeCheck className="h-5 w-5" />
                    Issuer DID Document
                  </CardTitle>
                  <CardDescription>Inspect the DID document and keys stored on the server.</CardDescription>
                </CardHeader>
                <CardContent>
                  {issuer ? (
                    <JsonBlock
                      title="Issuer"
                      data={{
                        ...issuer,
                        issuer_did_display: canonicalDid(issuer.issuer_did),
                      }}
                      onCopy={() => copy(issuer.issuer_did)}
                    />
                  ) : (
                    <DisabledNote text="Bootstrap the issuer to view its DID document." />
                  )}
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>
                    <FileCheck2 className="h-5 w-5" />
                    Recently issued credentials
                  </CardTitle>
                  <CardDescription>Random sample from this session. Copy IDs or status slots for QA.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {issuedCredentials.length === 0 ? (
                    <DisabledNote text="Issue a credential to populate this list." />
                  ) : (
                    issuedCredentials.map((credential) => (
                      <div
                        key={credential.id}
                        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{credential.id}</p>
                            <p className="text-xs text-slate-500">
                              Subject: {canonicalDid(credential.subject)} · Status slot: {credential.status.index}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{credential.schema}</Badge>
                            <Button size="sm" variant="outline" onClick={() => copy(credential.id)}>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy
                            </Button>
                          </div>
                        </div>
                        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">
                          {pretty({ attrs: credential.attrs, status: credential.status })}
                        </pre>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="issue">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <FileCheck2 className="h-5 w-5" />
                    Issue credential
                  </CardTitle>
                  <CardDescription>Provide a holder DID and the JSON payload to sign.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="subjectDid">Holder DID</Label>
                    <Input
                      id="subjectDid"
                      placeholder="did:key:..."
                      value={issueSubjectDid}
                      onChange={(event) => setIssueSubjectDid(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="idemKey">Idempotency key</Label>
                    <div className="flex gap-2">
                      <Input
                        id="idemKey"
                        value={issueIdemKey}
                        onChange={(event) => setIssueIdemKey(event.target.value)}
                      />
                      <Button
                        variant="secondary"
                        onClick={() => setIssueIdemKey(randomKey())}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        New
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="attributes">Attributes JSON</Label>
                    <Textarea
                      id="attributes"
                      value={issueAttributes}
                      onChange={(event) => setIssueAttributes(event.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" onClick={handleIssue} disabled={isIssueLoading}>
                    {isIssueLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    {isIssueLoading ? "Issuing…" : "Issue credential"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <Zap className="h-5 w-5" />
                    Response preview
                  </CardTitle>
                  <CardDescription>Inspect the payload returned by the API.</CardDescription>
                </CardHeader>
                <CardContent>
                  {issuedCredentials.length > 0 ? (
                    <JsonBlock
                      data={{
                        ...issuedCredentials[0],
                        issuer: canonicalDid(issuedCredentials[0].issuer),
                        subject: canonicalDid(issuedCredentials[0].subject),
                      }}
                      onCopy={() => copy(issuedCredentials[0].id)}
                    />
                  ) : (
                    <DisabledNote text="Issue at least one credential to view the response." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="revocation">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trash2 className="h-5 w-5" />
                    Revoke credential
                  </CardTitle>
                  <CardDescription>Marks a credential as revoked by inserting the status bit.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="revokeId">Credential id</Label>
                    <Input
                      id="revokeId"
                      value={revokeTarget}
                      onChange={(event) => setRevokeTarget(event.target.value)}
                      placeholder="cred:did:key:..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="statusListId">Status list id</Label>
                    <Input
                      id="statusListId"
                      value={statusListId}
                      onChange={(event) => setStatusListId(event.target.value)}
                      placeholder="status:did:key:..."
                    />
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col gap-3 md:flex-row">
                  <Button className="w-full" variant="outline" onClick={handleFetchStatus} disabled={isStatusLoading}>
                    {isStatusLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    {isStatusLoading ? "Refreshing…" : "Refresh status list"}
                  </Button>
                  <Button className="w-full" onClick={handleRevoke} disabled={isRevokeLoading}>
                    {isRevokeLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    {isRevokeLoading ? "Revoking…" : "Revoke"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Status list snapshot</CardTitle>
                  <CardDescription>Latest publication for the active list id.</CardDescription>
                </CardHeader>
                <CardContent>
                  {statusList ? (
                    <JsonBlock data={statusList} />
                  ) : (
                    <DisabledNote text="Refresh the status list to view its contents." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="offer">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Rocket className="h-5 w-5" />
                    Prepare issuance offer
                  </CardTitle>
                  <CardDescription>
                    Create a QR payload that a wallet can scan to kick off issuance.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Challenge / flow id</Label>
                    <Input
                      value={offerChallenge}
                      onChange={(event) => setOfferChallenge(event.target.value)}
                    />
                  </div>
                  <div className="space-y-3">
                    <Label>Claims requested</Label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {attributeKeys.map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selectedClaims[key] ?? true}
                            onChange={(event) =>
                              setSelectedClaims((prev) => ({
                                ...prev,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {key}
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">
                      {activeClaimsCount} field{activeClaimsCount === 1 ? "" : "s"} will be requested from the wallet.
                    </p>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button className="w-full" onClick={handleGenerateOffer} disabled={isOfferLoading}>
                    {isOfferLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                    {isOfferLoading ? "Preparing…" : "Generate offer"}
                  </Button>
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Issuance QR</CardTitle>
                  <CardDescription>Share this with a wallet to initiate issuance.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {offer ? (
                    <>
                      <div className="flex justify-center">
                        <QRCode value={pretty(offer)} size={180} includeMargin />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <Badge variant="secondary">challenge {canonicalDid(offerChallenge)}</Badge>
                        <Button variant="outline" size="sm" onClick={() => copy(pretty(offer))}>
                          <Copy className="mr-2 h-4 w-4" />
                          Copy payload
                        </Button>
                      </div>
                      <JsonBlock data={offer} compact />
                    </>
                  ) : (
                    <DisabledNote text="Configure the offer and generate a QR to preview it here." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
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

function DisabledNote({ text = "Perform the prerequisite action to populate this panel." }: { text?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      {text}
    </div>
  );
}
