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
  BadgeCheck,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  QrCode,
  RefreshCw,
  Shield,
  UserCheck,
} from "lucide-react";
import QRCode from "qrcode.react";

const DEFAULT_API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const STORAGE_KEY_BASE = "verifier-ui::api-base";
const STORAGE_KEY_VERIFIER = "verifier-ui::verifier";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const canonicalDid = (did?: string) => {
  if (!did) return "—";
  const parts = did.split(":");
  return parts[parts.length - 1];
};

interface DidDoc {
  did: string;
  public_sign: string;
  public_agree: string;
  service_endpoint: string;
}

interface VerifierBootstrap {
  verifier_did: string;
  did_doc: DidDoc;
}

interface ChallengeResponse {
  nonce: string;
  aud: string;
  exp: number;
}

interface PresentationRequest {
  type: string;
  api: string;
  verifier_did: string;
  reveal: string[];
  nonce: string;
}

interface VerifyResult {
  ok: boolean;
  message: string;
  disclosed: Record<string, unknown>;
}

interface VerificationEntry {
  id: string;
  request: PresentationRequest | null;
  disclosed: Record<string, unknown>;
  ok: boolean;
  message: string;
  at: number;
}

type ApiOptions = RequestInit & {
  query?: Record<string, string>;
};

const defaultRevealFields = ["name", "over18", "is_student"];

export default function App(): JSX.Element {
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE);
  const [verifierLabel, setVerifierLabel] = useState("Library Verifier");
  const [verifier, setVerifier] = useState<VerifierBootstrap | null>(null);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [revealSelection, setRevealSelection] = useState<Record<string, boolean>>(() => {
    const flags: Record<string, boolean> = {};
    defaultRevealFields.forEach((key) => {
      flags[key] = true;
    });
    return flags;
  });
  const [presentationRequest, setPresentationRequest] = useState<PresentationRequest | null>(null);
  const [presentationRequestText, setPresentationRequestText] = useState("");
  const [jwePayload, setJwePayload] = useState("");
  const [verificationHistory, setVerificationHistory] = useState<VerificationEntry[]>([]);
  const [isBootstrapLoading, setBootstrapLoading] = useState(false);
  const [isChallengeLoading, setChallengeLoading] = useState(false);
  const [isVerifying, setVerifying] = useState(false);
  const [showQr, setShowQr] = useState(true);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedBase = window.localStorage.getItem(STORAGE_KEY_BASE);
    const storedVerifier = window.localStorage.getItem(STORAGE_KEY_VERIFIER);
    if (storedBase) setApiBase(storedBase);
    if (storedVerifier) {
      try {
        const parsed = JSON.parse(storedVerifier) as VerifierBootstrap;
        setVerifier(parsed);
      } catch (error) {
        console.error("Failed to restore verifier", error);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY_BASE, apiBase);
  }, [apiBase]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (verifier) {
      window.localStorage.setItem(STORAGE_KEY_VERIFIER, JSON.stringify(verifier));
    } else {
      window.localStorage.removeItem(STORAGE_KEY_VERIFIER);
    }
  }, [verifier]);

  const apiFetch = async (path: string, options: ApiOptions = {}) => {
    const { query, ...init } = options;
    const urlWith = (prefix: string) => {
      const params = query ? `?${new URLSearchParams(query).toString()}` : "";
      return `${apiBase}${prefix}${path}${params}`;
    };

    const attempt = async (url: string) => {
      const response = await fetch(url, init);
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

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch (error) {
      console.error(error);
      toast.error("Unable to copy to clipboard");
    }
  };

  const handleBootstrap = async () => {
    setBootstrapLoading(true);
    try {
      const data = (await apiFetch("/bootstrap/verifier", {
        method: "POST",
        query: { label: verifierLabel || "Verifier" },
      })) as VerifierBootstrap;
      setVerifier(data);
      toast.success("Verifier ready");
    } catch (error) {
      console.error(error);
      toast.error("Bootstrap failed");
    } finally {
      setBootstrapLoading(false);
    }
  };

  const revealFields = useMemo(
    () => Object.entries(revealSelection).filter(([, enabled]) => enabled).map(([key]) => key),
    [revealSelection],
  );

  const handleChallenge = async () => {
    if (!verifier) {
      toast.error("Bootstrap the verifier first");
      return;
    }
    setChallengeLoading(true);
    try {
      const ch = (await apiFetch("/verifier/challenge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ aud: verifier.verifier_did }),
      })) as ChallengeResponse;
      setChallenge(ch);
      const request: PresentationRequest = {
        type: "vp-request",
        api: apiBase,
        verifier_did: verifier.verifier_did,
        reveal: revealFields,
        nonce: ch.nonce,
      };
      setPresentationRequest(request);
      setPresentationRequestText(pretty(request));
      toast.success("Challenge issued");
    } catch (error) {
      console.error(error);
      toast.error("Unable to issue challenge");
    } finally {
      setChallengeLoading(false);
    }
  };

  const handleVerify = async () => {
    let payload: Record<string, string>;
    try {
      payload = JSON.parse(jwePayload) as PresentationRequest;
    } catch (error) {
      toast.error("Presentation payload must be valid JSON");
      console.error(error);
      return;
    }
    setVerifying(true);
    try {
      const result = (await apiFetch("/verifier/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      })) as VerifyResult;
      toast.success(result.ok ? "Verified" : "Verification failed");
      const entry: VerificationEntry = {
        id: crypto?.randomUUID?.() ?? `${Date.now()}`,
        request: presentationRequest,
        disclosed: result.disclosed ?? {},
        ok: result.ok,
        message: result.message,
        at: Date.now(),
      };
      setVerificationHistory((prev) => [entry, ...prev].slice(0, 20));
    } catch (error) {
      console.error(error);
      toast.error("Verifier endpoint error");
    } finally {
      setVerifying(false);
    }
  };

  const toggleReveal = (key: string) => {
    setRevealSelection((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const activeRevealCount = useMemo(
    () => Object.values(revealSelection).filter(Boolean).length,
    [revealSelection],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-white text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8 pb-16">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Verifier Kiosk</h1>
            <p className="text-slate-600">
              Generate challenge QR codes, scan presentations, and view verification receipts.
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
            {verifier && (
              <p className="text-xs text-slate-500">
                Verifier DID: <span className="font-mono">{canonicalDid(verifier.verifier_did)}</span>
              </p>
            )}
          </div>
        </header>

        <Tabs defaultValue="setup">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="challenge">Challenge</TabsTrigger>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
          </TabsList>

          <TabsContent value="setup">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <UserCheck className="h-5 w-5" />
                    Bootstrap verifier DID
                  </CardTitle>
                  <CardDescription>Provision verification keys and DID document.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="verifierLabel">Label</Label>
                    <Input
                      id="verifierLabel"
                      value={verifierLabel}
                      onChange={(event) => setVerifierLabel(event.target.value)}
                    />
                  </div>
                  <Button onClick={handleBootstrap} disabled={isBootstrapLoading}>
                    {isBootstrapLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Shield className="mr-2 h-4 w-4" />
                    )}
                    {isBootstrapLoading ? "Bootstrapping…" : "Create verifier"}
                  </Button>
                </CardContent>
                <CardFooter>
                  {verifier ? (
                    <JsonBlock
                      data={{
                        ...verifier,
                        verifier_did_display: canonicalDid(verifier.verifier_did),
                      }}
                      onCopy={() => copy(verifier.verifier_did)}
                    />
                  ) : (
                    <DisabledNote text="Bootstrap the verifier to view the DID document." />
                  )}
                </CardFooter>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>
                    <BadgeCheck className="h-5 w-5" />
                    Reveal fields
                  </CardTitle>
                  <CardDescription>Select which claims you require from the wallet.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {Object.keys(revealSelection).map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <Switch checked={revealSelection[key]} onCheckedChange={() => toggleReveal(key)} />
                      {key}
                    </label>
                  ))}
                </CardContent>
                <CardFooter>
                  <p className="text-xs text-slate-500">
                    {activeRevealCount} field{activeRevealCount === 1 ? "" : "s"} required.
                  </p>
                </CardFooter>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="challenge">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <QrCode className="h-5 w-5" />
                    Challenge QR
                  </CardTitle>
                  <CardDescription>Generate a presentation request for wallets to scan.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button onClick={handleChallenge} disabled={isChallengeLoading || !verifier}>
                    {isChallengeLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <QrCode className="mr-2 h-4 w-4" />
                    )}
                    {isChallengeLoading ? "Issuing challenge…" : "Generate challenge"}
                  </Button>
                  {presentationRequest ? (
                    <>
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowQr((prev) => !prev)}>
                          {showQr ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                          {showQr ? "Hide QR" : "Show QR"}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => copy(pretty(presentationRequest))}>
                          <Copy className="mr-2 h-4 w-4" />
                          Copy payload
                        </Button>
                      </div>
                      {showQr && (
                        <div className="flex justify-center">
                          <QRCode value={pretty(presentationRequest)} size={180} includeMargin />
                        </div>
                      )}
                      <JsonBlock data={presentationRequest} compact />
                    </>
                  ) : (
                    <DisabledNote text="Generate a challenge to view the QR." />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Presentation inbox</CardTitle>
                  <CardDescription>Paste or scan a presentation package from the wallet.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder={'{ "protected": "...", "eph": "...", ... }'}
                    value={jwePayload}
                    onChange={(event) => setJwePayload(event.target.value)}
                    className="font-mono text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={() => setScannerOpen(true)}>
                      <QrCode className="mr-2 h-4 w-4" />
                      Scan QR
                    </Button>
                    <Button
                      onClick={handleVerify}
                      disabled={isVerifying || !jwePayload.trim()}
                    >
                      {isVerifying ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      {isVerifying ? "Verifying…" : "Verify"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="inbox">
            <Card>
              <CardHeader>
                <CardTitle>Verification history</CardTitle>
                <CardDescription>Recent presentation checks performed on this kiosk.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {verificationHistory.length === 0 ? (
                  <DisabledNote text="No verifications yet." />
                ) : (
                  verificationHistory.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {entry.ok ? "Verified" : "Rejected"} · {entry.message}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(entry.at).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant={entry.ok ? "default" : "destructive"}>
                          {entry.ok ? "ok" : "failed"}
                        </Badge>
                      </div>
                      <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">
                        {pretty(entry.disclosed)}
                      </pre>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <QrScanner
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          setScannerError(null);
        }}
        onResult={(text) => {
          setScannerOpen(false);
          setScannerError(null);
          setJwePayload(text);
        }}
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
