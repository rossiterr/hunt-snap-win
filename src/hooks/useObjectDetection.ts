import { useEffect, useRef, useState } from "react";

export type Detection = {
  bbox: [number, number, number, number]; // x, y, w, h (in video pixels)
  class: string;
  score: number;
};

type ModelLike = {
  detect: (input: HTMLVideoElement) => Promise<Detection[]>;
};

/**
 * Carrega COCO-SSD (TF.js) e roda detecção contínua sobre o <video>.
 * Retorna lista de detecções atualizada a cada ~frame (rAF), e um status.
 */
export function useObjectDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  enabled: boolean,
) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const modelRef = useRef<ModelLike | null>(null);
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  // Carrega o modelo uma vez (lazy import para não inflar o bundle inicial)
  useEffect(() => {
    let cancelled = false;
    if (!enabled || modelRef.current) return;
    setStatus("loading");
    (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        // tenta WebGL; cai para CPU se necessário
        try {
          await tf.setBackend("webgl");
        } catch {
          await tf.setBackend("cpu");
        }
        const cocoSsd = await import("@tensorflow-models/coco-ssd");
        const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        if (cancelled) return;
        modelRef.current = model as unknown as ModelLike;
        setStatus("ready");
      } catch (e) {
        console.error("Falha ao carregar COCO-SSD", e);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Loop de detecção
  useEffect(() => {
    if (!enabled || status !== "ready") return;
    const video = videoRef.current;
    if (!video) return;

    const tick = async () => {
      if (runningRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const v = videoRef.current;
      const m = modelRef.current;
      if (v && m && v.readyState >= 2 && v.videoWidth > 0) {
        runningRef.current = true;
        try {
          const preds = await m.detect(v);
          setDetections(preds);
        } catch (e) {
          console.error("detect error", e);
        } finally {
          runningRef.current = false;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setDetections([]);
    };
  }, [enabled, status, videoRef]);

  return { detections, status };
}