"use client";

import { useEffect, useRef, useState } from "react";
import { recordAuditItem } from "@/app/assets/actions";
import { SubmitButton } from "@/components/submit-button";

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

export function AssetAuditScanner({ auditId, locationId }: { auditId: string; locationId: string | null }) {
  const formRef = useRef<HTMLFormElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastValueRef = useRef("");
  const [cameraOn, setCameraOn] = useState(false);
  const [method, setMethod] = useState<"scan" | "manual">("scan");
  const [message, setMessage] = useState("USB/Bluetooth scanners can type directly into the code field.");

  function stopCamera() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  async function startCamera() {
    const DetectorClass = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!DetectorClass) {
      setMessage("Camera scanning is not supported in this browser. Use a hardware scanner or manual entry.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraOn(true);
      setMethod("scan");
      setMessage("Camera ready. Hold the asset label inside the frame.");
      const detector = new DetectorClass({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
      timerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const detected = await detector.detect(videoRef.current);
          const value = detected[0]?.rawValue?.trim();
          if (!value || value === lastValueRef.current) return;
          lastValueRef.current = value;
          const input = formRef.current?.elements.namedItem("scanned_code") as HTMLInputElement | null;
          if (input) input.value = value;
          setMessage(`Scanned ${value}. Saving observation…`);
          stopCamera();
          formRef.current?.requestSubmit();
        } catch {
          // Detection failures are expected while the camera is moving.
        }
      }, 450);
    } catch {
      setMessage("Camera permission was not granted. You can still use a hardware scanner or manual entry.");
    }
  }

  useEffect(() => stopCamera, []);

  return <section className="asset-scanner">
    <div className="asset-scanner-toolbar">
      <div><h3>Scan an asset</h3><p className="subtle">Every scan is time-stamped and added to the immutable asset history.</p></div>
      <button className="button secondary" onClick={cameraOn ? stopCamera : startCamera} type="button">{cameraOn ? "Stop camera" : "Use camera"}</button>
    </div>
    <div className={`asset-camera ${cameraOn ? "active" : ""}`}><video muted playsInline ref={videoRef} /><span>{cameraOn ? "Align QR or barcode in the frame" : "Camera preview"}</span></div>
    <p className="asset-scanner-message" role="status">{message}</p>
    <form action={recordAuditItem} className="form-grid three" ref={formRef}>
      <input name="audit_id" type="hidden" value={auditId} />
      <input name="observed_location_id" type="hidden" value={locationId ?? ""} />
      <input name="capture_method" type="hidden" value={method} />
      <label>Asset code / barcode<input autoComplete="off" autoFocus className="field asset-code-input" name="scanned_code" placeholder="Scan or enter label" required /></label>
      <label>Observed status<select className="select" defaultValue="" name="observed_status"><option value="">No change</option><option value="available">Available</option><option value="issued">Issued</option><option value="in_repair">In repair</option><option value="damaged">Damaged</option><option value="lost">Lost</option><option value="retired">Retired</option></select></label>
      <label>Observed condition<select className="select" defaultValue="good" name="observed_condition"><option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="unusable">Unusable</option></select></label>
      <label>Capture method<select className="select" onChange={(event) => setMethod(event.target.value as "scan" | "manual")} value={method}><option value="scan">Scanned label</option><option value="manual">Manual entry</option></select></label>
      {method === "manual" ? <label>Why manual?<input className="field" minLength={5} name="manual_reason" placeholder="Label missing / unreadable" required /></label> : <input name="manual_reason" type="hidden" value="" />}
      <label>Damage / audit photo<input accept="image/jpeg,image/png,image/webp,application/pdf" className="field" name="evidence" type="file" /></label>
      <label className="asset-notes-field">Notes<textarea className="textarea" name="notes" placeholder="Damage details, discrepancy or corrective action" rows={2} /></label>
      <div className="form-actions"><SubmitButton pendingText="Recording">Record observation</SubmitButton></div>
    </form>
  </section>;
}
