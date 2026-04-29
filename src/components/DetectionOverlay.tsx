import { useEffect, useState } from "react";
import type { Detection } from "@/hooks/useObjectDetection";

type Props = {
  detections: Detection[];
  videoRef: React.RefObject<HTMLVideoElement | null>;
  highlightClasses?: string[]; // classes a destacar (ligadas ao desafio)
};

/**
 * Desenha bounding boxes sobre o vídeo. Usa as dimensões reais do vídeo
 * e mapeia para o tamanho exibido (object-cover) — assumindo que o
 * container tem aspect-video e o vídeo cobre por inteiro.
 */
export function DetectionOverlay({
  detections,
  videoRef,
  highlightClasses = [],
}: Props) {
  const [size, setSize] = useState({ vw: 0, vh: 0 });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => {
      if (v.videoWidth && v.videoHeight) {
        setSize({ vw: v.videoWidth, vh: v.videoHeight });
      }
    };
    update();
    v.addEventListener("loadedmetadata", update);
    return () => v.removeEventListener("loadedmetadata", update);
  }, [videoRef]);

  if (!size.vw || !size.vh) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${size.vw} ${size.vh}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {detections.map((d, i) => {
        const [x, y, w, h] = d.bbox;
        const isMatch = highlightClasses.includes(d.class);
        const stroke = isMatch ? "#22c55e" : "#a78bfa";
        const fill = isMatch ? "rgba(34,197,94,0.12)" : "rgba(167,139,250,0.06)";
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={fill}
              stroke={stroke}
              strokeWidth={isMatch ? 6 : 3}
              rx={8}
            />
            <rect
              x={x}
              y={Math.max(0, y - 36)}
              width={Math.max(120, d.class.length * 16 + 60)}
              height={32}
              fill={stroke}
              rx={6}
            />
            <text
              x={x + 10}
              y={Math.max(22, y - 12)}
              fontSize={22}
              fontWeight={800}
              fill="#0b0b0f"
              fontFamily="ui-sans-serif, system-ui"
            >
              {d.class} {Math.round(d.score * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}