import * as React from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { X } from "lucide-react";

import { Button } from "../ui/button";

export interface QrScannerProps {
  open: boolean;
  onResult: (value: string) => void;
  onClose: () => void;
  onError?: (error: Error) => void;
  height?: number;
}

export function QrScanner({ open, onResult, onClose, onError, height = 288 }: QrScannerProps) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const reader = new BrowserQRCodeReader();
    let cancelled = false;

    (async () => {
      try {
        controlsRef.current = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current!,
          (result, error, controls) => {
            if (result) {
              onResult(result.getText());
              controls.stop();
              controlsRef.current = null;
              onClose();
            } else if (error && !(error as any)?.name?.includes("NotFound")) {
              console.error(error);
            }
          },
        );
      } catch (error) {
        if (!cancelled && error instanceof Error) {
          onError?.(error);
        }
      }
    })();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      reader.reset();
    };
  }, [open, onClose, onResult, onError]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Scan QR code</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            className="w-full object-cover"
            style={{ height }}
            muted
            playsInline
          />
        </div>
      </div>
    </div>
  );
}
