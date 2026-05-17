import { useState, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Detection } from "../types";
import { isHumanDetection, isVehicleDetection } from "../lib/alertLogic";
import { detectDualMode } from "../lib/api";

type MediaElement = HTMLImageElement | HTMLVideoElement;

// Motion detection — match each current vehicle to its nearest predecessor in
// the previous frame and flag isMoving if the center shifted significantly.
// Thresholds are fractions of the source frame's smaller dimension so they
// scale across resolutions.
const MATCH_FRACTION = 0.25;   // Max center distance to consider "same vehicle"
const MOTION_FRACTION = 0.035; // Center shift above this = moving

function center(b: [number, number, number, number]): [number, number] {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

function tagVehicleMotion(
  current: Detection[],
  previous: Detection[],
  sourceW: number,
  sourceH: number,
): Detection[] {
  const scale = Math.min(sourceW, sourceH) || 1;
  const matchDist = scale * MATCH_FRACTION;
  const motionDist = scale * MOTION_FRACTION;
  const prevVehicles = previous.filter((d) => d.isVehicle);

  return current.map((d) => {
    if (!d.isVehicle) return d;
    const [cx, cy] = center(d.bbox);
    let bestDist = Infinity;
    for (const p of prevVehicles) {
      const [px, py] = center(p.bbox);
      const dist = Math.hypot(cx - px, cy - py);
      if (dist < bestDist) bestDist = dist;
    }
    // If nothing close enough matched, treat as a brand-new detection
    // (not "moving" — we have no prior position to compare against).
    const isMoving = bestDist <= matchDist && bestDist > motionDist;
    return { ...d, isMoving };
  });
}

export function useDetection(
  mediaRef: RefObject<MediaElement | null>,
  enabled: boolean,
  threshold: number = 0.5,
  useBackend: boolean = true,
  gpsSpeed: number = 0
) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [sourceWidth, setSourceWidth] = useState(640);
  const [sourceHeight, setSourceHeight] = useState(480);
  const modelRef = useRef<any>(null);
  const previousDetectionsRef = useRef<Detection[]>([]);

  // ── Local TF.js model loading (fallback) ──
  useEffect(() => {
    if (!enabled) return;

    let mounted = true;
    const loadModel = async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        const cocoSsd = await import("@tensorflow-models/coco-ssd");
        const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        if (mounted) {
          modelRef.current = model;
          setModelLoaded(true);
        }
      } catch (err) {
        console.warn("TF.js model load failed:", err);
        // If backend mode is on, we don't need TF.js
        if (useBackend && mounted) {
          setModelLoaded(true);
        }
      }
    };
    loadModel();
    return () => { mounted = false; };
  }, [enabled]);

  // ── Canvas for capturing frames to send to backend ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const getCanvas = (): HTMLCanvasElement => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = 640;
      canvasRef.current.height = 480;
    }
    return canvasRef.current;
  };

  const captureFrame = (el: MediaElement): Blob | null => {
    const canvas = getCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    try {
      let w: number, h: number;
      if (el instanceof HTMLImageElement) {
        w = el.naturalWidth || 640;
        h = el.naturalHeight || 480;
      } else {
        w = el.videoWidth || 640;
        h = el.videoHeight || 480;
      }
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(el, 0, 0, w, h);

      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.8);
      }) as unknown as Blob | null;
    } catch {
      return null;
    }
  };

  // ── Detection loop ──
  useEffect(() => {
    if (!enabled || !modelLoaded) return;

    let stopped = false;

    const isReady = (el: MediaElement): boolean => {
      if (el instanceof HTMLImageElement) {
        return el.complete && el.naturalWidth > 0;
      }
      return el.readyState >= 2 && el.videoWidth > 0;
    };

    // ── Backend detection path ──
    const backendLoop = async () => {
      if (stopped) return;
      const el = mediaRef.current;

      if (el && isReady(el)) {
        try {
          // Capture frame to blob
          const canvas = getCanvas();
          const ctx = canvas.getContext("2d");
          if (!ctx) { setTimeout(backendLoop, 200); return; }

          let w: number, h: number;
          if (el instanceof HTMLImageElement) {
            w = el.naturalWidth || 640;
            h = el.naturalHeight || 480;
          } else {
            w = el.videoWidth || 640;
            h = el.videoHeight || 480;
          }
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(el, 0, 0, w, h);

          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8);
          });

          if (blob && !stopped) {
            const start = performance.now();
            const result = await detectDualMode(blob, gpsSpeed);
            const elapsed = Math.round(performance.now() - start);
            if (!stopped) {
              setInferenceMs(elapsed);
              setSourceWidth(w);
              setSourceHeight(h);

              // Convert backend response to Detection[] format with [x1,y1,x2,y2] bboxes
              const filtered: Detection[] = [];

              const pushObj = (d: any, isHuman: boolean, isVehicle: boolean, fallback: string) => {
                const box = (d.box ?? [0, 0, 0, 0]) as [number, number, number, number];
                filtered.push({
                  label: d.label || fallback,
                  confidence: Math.round(d.confidence),
                  bbox: box,
                  isHuman, isVehicle,
                });
              };

              for (const d of result.humans.details)   pushObj(d, true,  false, "person");
              for (const d of result.vehicles.details) pushObj(d, false, true,  "vehicle");
              for (const d of result.animals.details)  pushObj(d, false, false, "animal");

              // Pothole bboxes from Roboflow are center-style (x, y, width, height) — convert to xyxy
              if (result.pothole.detected) {
                for (const d of result.pothole.details) {
                  const cx = d.x || 0, cy = d.y || 0;
                  const pw = d.width || 0, ph = d.height || 0;
                  filtered.push({
                    label: "pothole",
                    confidence: Math.round(d.confidence),
                    bbox: [cx - pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2],
                    isHuman: false, isVehicle: false,
                  });
                }
              }

              const tagged = tagVehicleMotion(filtered, previousDetectionsRef.current, w, h);
              previousDetectionsRef.current = tagged;
              if (!stopped) setDetections(tagged);
            }
          }
        } catch (err) {
          // Backend unreachable — fall through to local detection on next tick
          console.warn("Backend detection failed, will retry:", err);
        }
      }

      // ~3 FPS for backend (saves bandwidth)
      if (!stopped) setTimeout(backendLoop, 333);
    };

    // ── Local TF.js detection path (fallback) ──
    const VALID = ["person", "car", "truck", "motorcycle", "bicycle", "bus", "dog", "cat"];
    const localLoop = async () => {
      if (stopped) return;
      const el = mediaRef.current;
      const model = modelRef.current;

      if (el && model && isReady(el)) {
        try {
          const start = performance.now();
          const preds = await model.detect(el);
          setInferenceMs(Math.round(performance.now() - start));

          // Source dims for overlay coordinate mapping
          const sw = el instanceof HTMLImageElement ? (el.naturalWidth || 640) : (el.videoWidth || 640);
          const sh = el instanceof HTMLImageElement ? (el.naturalHeight || 480) : (el.videoHeight || 480);
          setSourceWidth(sw);
          setSourceHeight(sh);

          const filtered: Detection[] = preds
            .filter((p: any) => p.score > threshold && VALID.includes(p.class))
            .map((p: any) => {
              // COCO-SSD returns [x, y, w, h] — convert to [x1, y1, x2, y2]
              const [x, y, w, h] = p.bbox as [number, number, number, number];
              return {
                label: p.class,
                confidence: Math.round(p.score * 100),
                bbox: [x, y, x + w, y + h] as [number, number, number, number],
                isHuman: isHumanDetection(p.class),
                isVehicle: isVehicleDetection(p.class),
              };
            });

          const tagged = tagVehicleMotion(filtered, previousDetectionsRef.current, sw, sh);
          previousDetectionsRef.current = tagged;
          if (!stopped) setDetections(tagged);
        } catch {
          // inference error — skip frame
        }
      }

      // ~5 FPS for local
      setTimeout(localLoop, 200);
    };

    if (useBackend) {
      backendLoop();
    } else {
      localLoop();
    }

    return () => { stopped = true; };
  }, [mediaRef, enabled, modelLoaded, threshold, useBackend, gpsSpeed]);

  return { detections, inferenceMs, modelLoaded, sourceWidth, sourceHeight };
}