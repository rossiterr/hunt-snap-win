import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useObjectDetection } from "@/hooks/useObjectDetection";
import { DetectionOverlay } from "@/components/DetectionOverlay";

export const Route = createFileRoute("/")({
  component: Index,
});

const CHALLENGES = [
  "uma caneca",
  "algo verde",
  "um livro",
  "um fone de ouvido",
  "uma garrafa de água",
  "uma caneta ou lápis",
  "um relógio",
  "algo vermelho",
  "uma planta",
  "um celular",
  "uma chave",
  "óculos",
  "um cartão ou crachá",
  "algo redondo",
  "uma mochila ou bolsa",
  "um controle remoto",
  "algo de metal brilhante",
  "uma folha de papel escrita",
];

type Verdict = {
  match: boolean;
  confidence: number;
  reason: string;
};

type Phase = "idle" | "playing" | "captured" | "judging" | "result";

function pickChallenge(exclude?: string) {
  const pool = CHALLENGES.filter((c) => c !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Mapeia o texto do desafio para classes do COCO-SSD (80 classes).
 * Quando há match, destacamos a bbox em verde — feedback em tempo real.
 * Quando não há match, o TF.js só desenha as caixas dos objetos vistos
 * (uso pedagógico) e o veredito final fica com o VLM no clique.
 */
const COCO_HINTS: Record<string, string[]> = {
  caneca: ["cup"],
  copo: ["cup", "wine glass"],
  xícara: ["cup"],
  garrafa: ["bottle"],
  água: ["bottle"],
  livro: ["book"],
  fone: ["cell phone"], // sem classe direta; deixamos vazio na prática
  celular: ["cell phone"],
  telefone: ["cell phone"],
  laptop: ["laptop"],
  notebook: ["laptop"],
  computador: ["laptop", "tv"],
  teclado: ["keyboard"],
  mouse: ["mouse"],
  monitor: ["tv"],
  tv: ["tv"],
  controle: ["remote"],
  remoto: ["remote"],
  relógio: ["clock"],
  planta: ["potted plant"],
  vaso: ["potted plant", "vase"],
  cadeira: ["chair"],
  sofá: ["couch"],
  cama: ["bed"],
  mesa: ["dining table"],
  tesoura: ["scissors"],
  faca: ["knife"],
  garfo: ["fork"],
  colher: ["spoon"],
  banana: ["banana"],
  maçã: ["apple"],
  laranja: ["orange"],
  bolo: ["cake"],
  pizza: ["pizza"],
  cachorro: ["dog"],
  gato: ["cat"],
  pessoa: ["person"],
  mochila: ["backpack"],
  bolsa: ["handbag"],
  guarda: ["umbrella"],
  chuva: ["umbrella"],
  gravata: ["tie"],
  óculos: [], // não está no COCO
};

function challengeToCocoClasses(challenge: string): string[] {
  const lower = challenge.toLowerCase();
  const matches = new Set<string>();
  for (const [keyword, classes] of Object.entries(COCO_HINTS)) {
    if (lower.includes(keyword)) classes.forEach((c) => matches.add(c));
  }
  return Array.from(matches);
}

function Index() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [challenge, setChallenge] = useState<string>(CHALLENGES[0]);
  const [customChallenge, setCustomChallenge] = useState("");
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(20);
  const [flash, setFlash] = useState<"success" | "fail" | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);

  // Detecção em tempo real (só roda enquanto está jogando e overlay ligado)
  const detectionEnabled = phase === "playing" && showBoxes;
  const { detections, status: detStatus } = useObjectDetection(
    videoRef,
    detectionEnabled,
  );
  const highlightClasses = challengeToCocoClasses(challenge);
  const hasMatchInFrame = detections.some((d) =>
    highlightClasses.includes(d.class),
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: 1280, height: 720 },
          audio: false,
        });
        streamRef.current = stream;
      }
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      if (videoRef.current) {
        try {
          await videoRef.current.play();
        } catch {
          /* autoplay interruption ignored */
        }
      }
    } catch (e) {
      console.error(e);
      setError(
        "Não consegui acessar a câmera. Verifique as permissões do navegador.",
      );
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Reatacha o stream ao <video> sempre que voltamos ao modo "playing"
  // (o elemento é remontado porque alternamos entre <img> capturado e <video>).
  useEffect(() => {
    if (phase !== "playing") return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (v && s && v.srcObject !== s) {
      v.srcObject = s;
      v.play().catch(() => {});
    } else if (!s) {
      startCamera();
    }
  }, [phase, startCamera]);

  // Timer do round
  useEffect(() => {
    if (phase !== "playing") return;
    setTimeLeft(20);
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(id);
          handleTimeout();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  function handleTimeout() {
    setVerdict({
      match: false,
      confidence: 1,
      reason: "Tempo esgotado! Tente ser mais rápido na próxima.",
    });
    setFlash("fail");
    setTimeout(() => setFlash(null), 900);
    setPhase("result");
  }

  async function startGame() {
    const custom = customChallenge.trim();
    const chosen = custom.length > 0 ? custom : pickChallenge();
    setChallenge(chosen);
    setRound((r) => r + 1);
    setVerdict(null);
    setCapturedImage(null);
    setPhase("playing");
    await startCamera();
  }

  function nextRound() {
    setCustomChallenge("");
    const next = pickChallenge(challenge);
    setChallenge(next);
    setRound((r) => r + 1);
    setVerdict(null);
    setCapturedImage(null);
    setPhase("playing");
    // garante que o stream volte a ser exibido no <video> remontado
    requestAnimationFrame(() => {
      const v = videoRef.current;
      const s = streamRef.current;
      if (v && s) {
        v.srcObject = s;
        v.play().catch(() => {});
      } else {
        startCamera();
      }
    });
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    setCapturedImage(dataUrl);
    setPhase("captured");
  }

  async function judge() {
    if (!capturedImage) return;
    setPhase("judging");
    setError(null);
    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: capturedImage, target: challenge }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erro ao validar");
        setPhase("captured");
        return;
      }
      const v = data as Verdict;
      setVerdict(v);
      if (v.match) {
        const points = Math.max(10, Math.round(50 * (v.confidence || 0.5) + timeLeft));
        setScore((s) => s + points);
        setFlash("success");
      } else {
        setFlash("fail");
      }
      setTimeout(() => setFlash(null), 900);
      setPhase("result");
    } catch (e) {
      console.error(e);
      setError("Falha de rede ao contatar a IA.");
      setPhase("captured");
    }
  }

  function retake() {
    setCapturedImage(null);
    setVerdict(null);
    setPhase("playing");
  }

  return (
    <main className="min-h-screen px-4 py-6 md:py-10">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="bg-[var(--gradient-hero)] bg-clip-text text-2xl font-black tracking-tight text-transparent md:text-4xl">
              Caça ao Tesouro com IA
            </h1>
            <p className="mt-1 text-xs text-muted-foreground md:text-sm">
              Visão Computacional + Games · Tendências em Mídias
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card/60 px-4 py-2 text-right shadow-[var(--shadow-glow)] backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Pontos
            </div>
            <div className="text-2xl font-black text-primary md:text-3xl">
              {score}
            </div>
          </div>
        </header>

        {/* Idle */}
        {phase === "idle" && (
          <section className="animate-pop-in rounded-3xl border border-border bg-card/70 p-6 shadow-[var(--shadow-glow-pink)] backdrop-blur md:p-10">
            <h2 className="text-xl font-bold md:text-2xl">Como funciona</h2>
            <ol className="mt-4 space-y-2 text-sm text-muted-foreground md:text-base">
              <li>
                <span className="mr-2 font-bold text-accent">1.</span>
                A IA sorteia (ou você escolhe) um objeto para encontrar.
              </li>
              <li>
                <span className="mr-2 font-bold text-accent">2.</span>
                Você tem 20s para apontar a câmera e tirar uma foto.
              </li>
              <li>
                <span className="mr-2 font-bold text-accent">3.</span>
                A IA julga a imagem e libera pontos se você acertou.
              </li>
            </ol>

            <div className="mt-6">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Desafio customizado (opcional)
              </label>
              <input
                value={customChallenge}
                onChange={(e) => setCustomChallenge(e.target.value)}
                placeholder='ex: "algo amarelo", "um tênis"'
                className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-sm outline-none ring-primary/40 transition focus:ring-2"
              />
            </div>

            <Button
              onClick={startGame}
              className="mt-6 h-14 w-full rounded-2xl btn-hero text-base font-bold shadow-[var(--shadow-glow)]"
            >
              Começar caçada ▶
            </Button>
            {error && (
              <p className="mt-3 text-center text-sm text-destructive">{error}</p>
            )}
          </section>
        )}

        {/* Playing / Captured / Judging / Result */}
        {phase !== "idle" && (
          <section className="space-y-4">
            {/* Challenge card */}
            <div className="animate-pop-in rounded-3xl border border-border bg-card/70 p-5 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-accent">
                    Encontre
                  </div>
                  <div className="text-lg font-black md:text-2xl">
                    {challenge}
                  </div>
                </div>
                {phase === "playing" && (
                  <div
                    className={`rounded-full border border-border px-4 py-2 text-xl font-black tabular-nums ${
                      timeLeft <= 5 ? "text-destructive" : "text-primary"
                    }`}
                  >
                    {timeLeft}s
                  </div>
                )}
              </div>
            </div>

            {/* Camera / captured */}
            <div
              className={`relative overflow-hidden rounded-3xl border border-border bg-black shadow-[var(--shadow-glow)] ${
                flash === "success" ? "animate-flash-success" : ""
              } ${flash === "fail" ? "animate-flash-fail" : ""}`}
            >
              <div className="aspect-video w-full">
                {capturedImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={capturedImage}
                    alt="captura"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                )}
                {/* Overlay de detecção em tempo real (TF.js / COCO-SSD) */}
                {phase === "playing" && showBoxes && !capturedImage && (
                  <DetectionOverlay
                    detections={detections}
                    videoRef={videoRef}
                    highlightClasses={highlightClasses}
                  />
                )}
                {/* Badge de status do modelo + indicador de match em tempo real */}
                {phase === "playing" && (
                  <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBoxes((s) => !s)}
                      className={`rounded-full border border-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider backdrop-blur transition ${
                        showBoxes
                          ? "bg-primary/80 text-primary-foreground"
                          : "bg-black/60 text-white/80"
                      }`}
                    >
                      {showBoxes ? "🟢 IA local on" : "⚪ IA local off"}
                    </button>
                    {showBoxes && (
                      <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1 text-[11px] font-semibold text-white/90 backdrop-blur">
                        {detStatus === "loading" && "carregando modelo…"}
                        {detStatus === "ready" &&
                          (highlightClasses.length === 0
                            ? "modelo não cobre este desafio — use o juiz IA"
                            : hasMatchInFrame
                              ? "✨ candidato detectado!"
                              : `procurando: ${highlightClasses.join(", ")}`)}
                        {detStatus === "error" && "modelo falhou"}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {phase === "judging" && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                  <div className="text-center">
                    <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    <p className="mt-3 font-bold text-primary">
                      A IA está julgando...
                    </p>
                  </div>
                </div>
              )}

              {phase === "result" && verdict && (
                <div
                  className={`absolute inset-0 flex items-center justify-center backdrop-blur-sm ${
                    verdict.match
                      ? "bg-primary/30"
                      : "bg-destructive/30"
                  }`}
                >
                  <div className="animate-pop-in rounded-3xl border border-border bg-card/90 px-8 py-6 text-center shadow-2xl">
                    <div className="text-5xl md:text-6xl">
                      {verdict.match ? "🎯" : "❌"}
                    </div>
                    <div
                      className={`mt-2 text-2xl font-black md:text-3xl ${
                        verdict.match ? "text-primary" : "text-destructive"
                      }`}
                    >
                      {verdict.match ? "Acertou!" : "Não rolou"}
                    </div>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
                      {verdict.reason}
                    </p>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Confiança da IA: {Math.round((verdict.confidence || 0) * 100)}%
                    </div>
                  </div>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            {/* Controls */}
            <div className="flex flex-wrap gap-3">
              {phase === "playing" && (
                <Button
                  onClick={capture}
                  className="h-14 flex-1 rounded-2xl btn-hero text-base font-bold shadow-[var(--shadow-glow)]"
                >
                  📸 Capturar
                </Button>
              )}
              {phase === "captured" && (
                <>
                  <Button
                    onClick={judge}
                    className="h-14 flex-1 rounded-2xl btn-hero text-base font-bold shadow-[var(--shadow-glow)]"
                  >
                    ✅ Enviar para IA
                  </Button>
                  <Button
                    onClick={retake}
                    variant="outline"
                    className="h-14 rounded-2xl border-border bg-card/60 px-6 text-base font-bold"
                  >
                    Refazer
                  </Button>
                </>
              )}
              {phase === "result" && (
                <>
                  <Button
                    onClick={nextRound}
                    className="h-14 flex-1 rounded-2xl btn-hero text-base font-bold shadow-[var(--shadow-glow)]"
                  >
                    Próximo desafio →
                  </Button>
                  <Button
                    onClick={() => {
                      stopCamera();
                      setPhase("idle");
                    }}
                    variant="outline"
                    className="h-14 rounded-2xl border-border bg-card/60 px-6 text-base font-bold"
                  >
                    Encerrar
                  </Button>
                </>
              )}
            </div>

            {error && (
              <p className="text-center text-sm text-destructive">{error}</p>
            )}
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-muted-foreground">
          Feito com Lovable · IA de visão via Gemini 2.5 Flash
        </footer>
      </div>
    </main>
  );
}
