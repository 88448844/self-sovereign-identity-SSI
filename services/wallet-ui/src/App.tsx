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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  QrScanner,
} from "@kit";
import { toast } from "sonner";
import {
  BookMarked,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  PlayCircle,
  QrCode,
  RefreshCw,
  Scan,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import QRCode from "qrcode.react";

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const STORAGE_KEY_BASE = "wallet-ui::api-base";
const STORAGE_KEY_HOLDER = "wallet-ui::holder";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const canonicalDid = (did?: string) => {
  if (!did) return "—";
  const parts = did.split(":");
  return parts[parts.length - 1];
};
const randomKey = () => crypto?.randomUUID?.() ?? `idem-${Date.now()}`;
const copy = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch (error) {
    console.error(error);
    toast.error("Unable to copy to clipboard");
  }
};

const defaultAttributes = {
  name: "Alice Example",
  over18: true,
  is_student: true,
};

interface DidDoc {
  did: string;
  public_sign: string;
  public_agree: string;
  service_endpoint: string;
}

interface HolderBootstrap {
  holder_did: string;
  did_doc: DidDoc;
}

interface CredentialRecord {
  id: string;
  issuer: string;
  subject: string;
  schema: string;
  attrs: Record<string, unknown>;
  status: { list_id: string; index: number };
  issued_at: number;
  issuer_signature: string;
}

interface PresentationBox {
  protected: string;
  eph: string;
  nonce: string;
  ct: string;
  tag: string;
}

interface VerifyResult {
  ok: boolean;
  message: string;
  disclosed: Record<string, unknown>;
}

interface IssuanceOffer {
  type: string;
  api: string;
  issuer_did: string;
  claims: Record<string, boolean>;
  challenge: string;
  issued_at?: number;
}

interface PresentationRequest {
  type: string;
  api: string;
  verifier_did: string;
  reveal: string[];
  nonce: string;
}

type ApiOptions = RequestInit & {
  query?: Record<string, string>;
};

export default function App(): JSX.Element {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [holderLabel, setHolderLabel] = useState("Wallet User");
  const [holder, setHolder] = useState<HolderBootstrap | null>(null);
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [revealSelection, setRevealSelection] = useState<Record<string, boolean>>({});
  const [issuanceOfferText, setIssuanceOfferText] = useState("");
  const [activeOffer, setActiveOffer] = useState<IssuanceOffer | null>(null);
  const [claimAttributes, setClaimAttributes] = useState<Record<string, string | boolean>>({
    name: "Alice Example",
    over18: true,
    is_student: true,
  });
  const [claimChallenge, setClaimChallenge] = useState("");
  const [claimLoading, setClaimLoading] = useState(false);
  const [presentationRequestText, setPresentationRequestText] = useState("");
  const [presentationRequest, setPresentationRequest] = useState<PresentationRequest | null>(null);
  const [presentationBox, setPresentationBox] = useState<PresentationBox | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [isBootstrapLoading, setBootstrapLoading] = useState(false);
  const [isCredentialsLoading, setCredentialsLoading] = useState(false);
  const [isPresenting, setPresenting] = useState(false);
  const [scannerMode, setScannerMode] = useState<"issuance" | "presentation" | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedBase = window.localStorage.getItem(STORAGE_KEY_BASE);
    const storedHolder = window.localStorage.getItem(STORAGE_KEY_HOLDER);
    if (storedBase) setApiBase(storedBase);
    if (storedHolder) {
      try {
        const parsed = JSON.parse(storedHolder) as HolderBootstrap;
        setHolder(parsed);
        loadCredentials(parsed.holder_did, parsed);
      } catch (error) {
        console.error("Failed to restore holder", error);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY_BASE, apiBase);
  }, [apiBase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (holder) {
      window.localStorage.setItem(STORAGE_KEY_HOLDER, JSON.stringify(holder));
    } else {
      window.localStorage.removeItem(STORAGE_KEY_HOLDER);
    }
  }, [holder]);

  const apiFetch = async (path: string, options: ApiOptions = {}) => {
    const { query, ...init } = options;
    const urlWith = (prefix: string) => {
      const params = query ? `?${new URLSearchParams(query).toString()}` : "";
      return `${apiBase}${prefix}${path}${params}`;
    };

    const request: RequestInit = {
      ...init,
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
        // ignore
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}\n${url}\n${body || "(empty body)"}`);
    }
    return response.json();
  };

  const loadCredentials = async (holderDid: string, holderBootstrap?: HolderBootstrap) => {
    if (!holderDid) return;
    setCredentialsLoading(true);
    try {
      const data = (await apiFetch(`/holder/credentials/${encodeURIComponent(holderDid)}`)) as {
        credentials: CredentialRecord[];
      };
      setCredentials(data.credentials);
      if (!selectedCredentialId && data.credentials.length) {
        setSelectedCredentialId(data.credentials[0].id);
        prepareRevealSelection(data.credentials[0]);
      }
      if (holderBootstrap) {
        setHolder(holderBootstrap);
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load credentials");
    } finally {
      setCredentialsLoading(false);
    }
  };

  const prepareRevealSelection = (credential: CredentialRecord) => {
    const next: Record<string, boolean> = {};
    Object.keys(credential.attrs ?? {}).forEach((key) => {
      next[key] = true;
    });
    setRevealSelection(next);
  };

  const handleBootstrap = async () => {
    setBootstrapLoading(true);
    try {
      const data = (await apiFetch("/bootstrap/holder", {
        method: "POST",
        query: { label: holderLabel || "Wallet User" },
      })) as HolderBootstrap;
      setHolder(data);
      setSelectedCredentialId(null);
      setCredentials([]);
      toast.success("Holder DID created");
    } catch (error) {
      console.error(error);
      toast.error("Bootstrap failed");
    } finally {
      setBootstrapLoading(false);
    }
  };

  const handleParseOffer = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as IssuanceOffer;
      if (parsed.type !== "issuance-init") {
        throw new Error("Unexpected payload type");
      }
      setActiveOffer(parsed);
      setClaimChallenge(parsed.challenge);
      const nextAttributes: Record<string, string | boolean> = {};
      Object.keys(parsed.claims ?? {}).forEach((key) => {
        nextAttributes[key] = (defaultAttributes as Record<string, string | boolean>)[key] ?? "";
      });
      setClaimAttributes(nextAttributes);
      toast.success("Issuance offer ready");
    } catch (error) {
      console.error(error);
      toast.error("Invalid issuance offer payload");
    }
  };

  const handleParsePresentationRequest = (raw: string) => {
    try {
      const parsed = JSON.parse(raw) as PresentationRequest;
      if (parsed.type !== "vp-request") {
        throw new Error("Unexpected payload type");
      }
      setPresentationRequest(parsed);
      toast.success("Verifier request loaded");
    } catch (error) {
      console.error(error);
      toast.error("Invalid presentation request payload");
    }
  };

  const handleClaim = async () => {
    if (!holder) {
      toast.error("Bootstrap or restore a holder first");
      return;
    }
    if (!activeOffer) {
      toast.error("Load an issuance offer");
      return;
    }
    setClaimLoading(true);
    try {
      const attributes: Record<string, unknown> = {};
      Object.entries(claimAttributes).forEach(([key, value]) => {
        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (normalized === "true") {
            attributes[key] = true;
          } else if (normalized === "false") {
            attributes[key] = false;
          } else {
            attributes[key] = value;
          }
        } else {
          attributes[key] = value;
        }
      });
      const credential = (await apiFetch("/wallet/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          "Idempotency-Key": randomKey(),
        },
        body: JSON.stringify({
          challenge: claimChallenge,
          holder_did: holder.holder_did,
          attributes,
        }),
      })) as CredentialRecord;
      toast.success("Credential received");
      setActiveOffer(null);
      setIssuanceOfferText("");
      setPresentationRequestText("");
      await loadCredentials(holder.holder_did);
      setSelectedCredentialId(credential.id);
      prepareRevealSelection(credential);
    } catch (error) {
      console.error(error);
      toast.error("Issuance claim failed");
    } finally {
      setClaimLoading(false);
    }
  };

  const currentCredential = useMemo(
    () => credentials.find((cred) => cred.id === selectedCredentialId) ?? null,
    [credentials, selectedCredentialId],
  );

  const attributeKeys = useMemo(() => Object.keys(currentCredential?.attrs ?? {}), [currentCredential]);

  useEffect(() => {
    if (currentCredential) {
      prepareRevealSelection(currentCredential);
    }
  }, [currentCredential?.id]);

  const handlePresent = async () => {
    if (!holder || !currentCredential || !presentationRequest) {
      toast.error("Select credential and load verifier request");
      return;
    }
    const revealFields = attributeKeys.filter((key) => revealSelection[key]);
    setPresenting(true);
    try {
      const box = (await apiFetch("/holder/present", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          holder_did: holder.holder_did,
          cred_id: currentCredential.id,
          verifier_did: presentationRequest.verifier_did,
          reveal_fields: revealFields,
        }),
      })) as { box: PresentationBox };
      setPresentationBox(box.box);
      toast.success("Presentation packaged");
      try {
        const verification = (await apiFetch("/verifier/verify", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            ...box.box,
          }),
        })) as VerifyResult;
        setVerifyResult(verification);
      } catch (error) {
        console.error(error);
        toast.error("Verifier rejected presentation");
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to create presentation");
    } finally {
      setPresenting(false);
    }
  };

  const toggleReveal = (key: string) => {
    setRevealSelection((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleScanResult = (text: string) => {
    if (scannerMode === "issuance") {
      setIssuanceOfferText(text);
      handleParseOffer(text);
    } else if (scannerMode === "presentation") {
      setPresentationRequestText(text);
      handleParsePresentationRequest(text);
    }
    setScannerMode(null);
  };

  const claimAttributeInputs = Object.entries(claimAttributes).map(([key, value]) => (
    <div key={key} className="space-y-2">
      <Label>{key}</Label>
      {typeof value === "boolean" ? (
        <div className="flex items-center gap-2">
          <Switch
            checked={Boolean(value)}
            onCheckedChange={(next) =>
              setClaimAttributes((prev) => ({
                ...prev,
                [key]: next,
              }))
            }
          />
          <span className="text-sm text-slate-600">{nextLabel(Boolean(value))}</span>
        </div>
      ) : (
        <Input
          value={String(value ?? "")}
          onChange={(event) =>
            setClaimAttributes((prev) => ({
              ...prev,
              [key]: event.target.value,
            }))
          }
        />
      )}
    </div>
  ));

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-white text-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-8 pb-16">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Wallet</h1>
            <p className="text-slate-600">
              Manage your holder DID, fetch credentials, claim offers, and respond to verifier requests.
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
              <Button variant="outline" onClick={() => toast(`Using ${apiBase}`)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Update
              </Button>
            </div>
            {holder && (
              <p className="text-xs text-slate-500">
                Holder DID: <span className="font-mono">{canonicalDid(holder.holder_did)}</span>
              </p>
            )}
          </div>
        </header>

        <Tabs defaultValue="holder">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="holder">Holder</TabsTrigger>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
            <TabsTrigger value="issuance">Claim offer</TabsTrigger>
            <TabsTrigger value="presentation">Present</TabsTrigger>
          </TabsList>

          <TabsContent value="holder">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <UserPlus className="h-5 w-5" />
                    Bootstrap holder DID
                  </CardTitle>
                  <CardDescription>Create a fresh holder identity with signing keys.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="holderLabel">Label</Label>
                    <Input
                      id="holderLabel"
                      value={holderLabel}
                      onChange={(event) => setHolderLabel(event.target.value)}
                    />
                  </div>
                  <Button onClick={handleBootstrap} disabled={isBootstrapLoading}>
                    {isBootstrapLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="mr-2 h-4 w-4" />
                    )}
                    {isBootstrapLoading ? "Issuing DID…" : "Create holder"}
                  </Button>
                </CardContent>
                <CardFooter>
                  {holder ? (
                    <JsonBlock
                      data={{
                        ...holder,
                        holder_did_display: canonicalDid(holder.holder_did),
                      }}
                      onCopy={() => copy(holder.holder_did)}
                    />
                  ) : (
                    <DisabledNote text="Bootstrap a holder to view its DID document." />
                  )}
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <BookMarked className="h-5 w-5" />
                    My credentials
                  </CardTitle>
                  <CardDescription>Fetch and manage credentials stored on the server.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => holder && loadCredentials(holder.holder_did)}
                      disabled={isCredentialsLoading || !holder}
                    >
                      {isCredentialsLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      {isCredentialsLoading ? "Refreshing…" : "Refresh list"}
                    </Button>
                    <span className="text-xs text-slate-500">
                      {credentials.length} credential{credentials.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </CardContent>
                <CardFooter>
                  {credentials.length ? (
                    <div className="space-y-3 w-full">
                      {credentials.map((credential) => (
                        <button
                          key={credential.id}
                          type="button"
                          onClick={() => {
                            setSelectedCredentialId(credential.id);
                            prepareRevealSelection(credential);
                          }}
                          className={`w-full rounded-xl border p-3 text-left transition ${
                            credential.id === selectedCredentialId
                              ? "border-slate-900 bg-slate-900/5"
                              : "border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm text-slate-800">
                              {canonicalDid(credential.issuer)} · slot {credential.status.index}
                            </span>
                            <Badge variant={credential.id === selectedCredentialId ? "default" : "secondary"}>
                              {credential.schema}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{credential.id}</p>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <DisabledNote text="No credentials yet. Claim an issuance offer to receive one." />
                  )}
                </CardFooter>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="credentials">
            <Card>
              <CardHeader>
                <CardTitle>Credential preview</CardTitle>
                <CardDescription>Inspect the selected credential payload.</CardDescription>
              </CardHeader>
              <CardContent>
                {currentCredential ? (
                  <JsonBlock
                    data={{
                      ...currentCredential,
                      issuer: canonicalDid(currentCredential.issuer),
                      subject: canonicalDid(currentCredential.subject),
                    }}
                    onCopy={() => copy(currentCredential.id)}
                  />
                ) : (
                  <DisabledNote text="Select a credential from the list." />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="issuance">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <QrCode className="h-5 w-5" />
                    Issuance offer
                  </CardTitle>
                  <CardDescription>Paste or scan a QR from the issuer portal.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder={'{ "type": "issuance-init", ... }'}
                    value={issuanceOfferText}
                    onChange={(event) => setIssuanceOfferText(event.target.value)}
                    className="font-mono text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        handleParseOffer(issuanceOfferText);
                      }}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Parse
                    </Button>
                    <Button variant="outline" onClick={() => setScannerMode("issuance")}> 
                      <Scan className="mr-2 h-4 w-4" />
                      Scan QR
                    </Button>
                  </div>
                  {activeOffer ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="font-medium">Issuer: {canonicalDid(activeOffer.issuer_did)}</p>
                      <p>Claims requested: {Object.keys(activeOffer.claims).join(", ") || "—"}</p>
                      <p className="text-xs text-slate-500">Challenge {activeOffer.challenge}</p>
                    </div>
                  ) : (
                    <DisabledNote text="Load an offer to continue." />
                  )}
                </CardContent>
                <CardFooter>
                  {activeOffer ? (
                    <JsonBlock data={activeOffer} compact />
                  ) : (
                    <span className="text-xs text-slate-500">Awaiting offer payload.</span>
                  )}
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <ShieldCheck className="h-5 w-5" />
                    Provide attributes
                  </CardTitle>
                  <CardDescription>Review and approve the claims requested by the issuer.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {activeOffer ? (
                    <>
                      {claimAttributeInputs.length ? (
                        <div className="grid grid-cols-1 gap-4">{claimAttributeInputs}</div>
                      ) : (
                        <DisabledNote text="No claims requested." />
                      )}
                      <div className="space-y-2">
                        <Label>Challenge reference</Label>
                        <Input value={claimChallenge} onChange={(event) => setClaimChallenge(event.target.value)} />
                      </div>
                      <Button className="w-full" onClick={handleClaim} disabled={claimLoading}>
                        {claimLoading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PlayCircle className="mr-2 h-4 w-4" />
                        )}
                        {claimLoading ? "Claiming…" : "Claim credential"}
                      </Button>
                    </>
                  ) : (
                    <DisabledNote text="Load an issuance offer to respond." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="presentation">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <QrCode className="h-5 w-5" />
                    Verifier request
                  </CardTitle>
                  <CardDescription>Paste or scan a QR from the verifier kiosk.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder={'{ "type": "vp-request", ... }'}
                    value={presentationRequestText}
                    onChange={(event) => setPresentationRequestText(event.target.value)}
                    className="font-mono text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleParsePresentationRequest(presentationRequestText)}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Parse
                    </Button>
                    <Button variant="outline" onClick={() => setScannerMode("presentation")}> 
                      <Scan className="mr-2 h-4 w-4" />
                      Scan QR
                    </Button>
                  </div>
                  {presentationRequest ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="font-medium">Verifier: {canonicalDid(presentationRequest.verifier_did)}</p>
                      <p>Reveal fields: {presentationRequest.reveal.join(", ") || "—"}</p>
                      <p className="text-xs text-slate-500">Nonce {presentationRequest.nonce}</p>
                    </div>
                  ) : (
                    <DisabledNote text="Awaiting verifier payload." />
                  )}
                </CardContent>
                <CardFooter>
                  {presentationRequest ? (
                    <JsonBlock data={presentationRequest} compact />
                  ) : (
                    <span className="text-xs text-slate-500">Provide a verifier payload to prepare the presentation.</span>
                  )}
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Selective disclosure</CardTitle>
                  <CardDescription>Toggle which fields you consent to reveal.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {currentCredential ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {attributeKeys.map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm">
                          <Switch checked={revealSelection[key]} onCheckedChange={() => toggleReveal(key)} />
                          {key}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <DisabledNote text="Select a credential to configure disclosure." />
                  )}
                  <Button
                    className="w-full"
                    onClick={handlePresent}
                    disabled={isPresenting || !presentationRequest || !currentCredential}
                  >
                    {isPresenting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}
                    {isPresenting ? "Packaging…" : "Present to verifier"}
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Presentation package</CardTitle>
                  <CardDescription>Encrypted payload destined for the verifier.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {presentationBox ? (
                    <>
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowQr((prev) => !prev)}>
                          {showQr ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                          {showQr ? "Hide QR" : "Show QR"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => copy(pretty(presentationBox))}>
                          <Copy className="mr-2 h-4 w-4" />
                          Copy JSON
                        </Button>
                      </div>
                      {showQr && (
                        <div className="flex justify-center">
                          <QRCode value={pretty(presentationBox)} size={180} includeMargin />
                        </div>
                      )}
                      <JsonBlock
                        data={{
                          ...presentationBox,
                          ct: maskCiphertext(presentationBox.ct),
                        }}
                        compact
                      />
                    </>
                  ) : (
                    <DisabledNote text="Prepare a presentation to view the payload." />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Verification receipt</CardTitle>
                  <CardDescription>Outcome returned by the verifier endpoint.</CardDescription>
                </CardHeader>
                <CardContent>
                  {verifyResult ? (
                    <JsonBlock data={verifyResult} />
                  ) : (
                    <DisabledNote text="Present to the verifier to view the receipt." />
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <QrScanner
        open={scannerMode !== null}
        onClose={() => {
          setScannerMode(null);
          setScannerError(null);
        }}
        onResult={handleScanResult}
        onError={(error) => setScannerError(error.message)}
      />
      {scannerError && (
        <div className="fixed bottom-6 left-1/2 z-40 w-[90%] max-w-lg -translate-x-1/2 rounded-xl bg-red-600 px-4 py-2 text-center text-sm text-white shadow-lg">
          {scannerError}
        </div>
      )}
    </div>
  );
}

function JsonBlock({
  data,
  compact = false,
  onCopy,
}: {
  data: unknown;
  compact?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-inner">
      <div className="mb-2 flex items-center justify-between">
        <Badge variant="secondary">JSON</Badge>
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

function DisabledNote({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      {text}
    </div>
  );
}

function maskCiphertext(value: string, keep = 18) {
  if (!value) return value;
  return value.length <= keep * 2 ? value : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

function nextLabel(value: boolean) {
  return value ? "True" : "False";
}
