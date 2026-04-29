import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Index,
});

type Verdict = {
  match: boolean;
  confidence: number;
  reason: string;
};

type Phase = "idle" | "playing" | "captured" | "judging" | "result" | "gameover";

const MAX_LIVES = 3;

function Index() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [challenge, setChallenge] = useState<string>("");
  const [context, setContext] = useState("");
  const [previousChallenges, setPreviousChallenges] = useState<string[]>([]);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(MAX_LIVES);
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(20);
  const [flash, setFlash] = useState<"success" | "fail" | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(false);

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
    const newLives = lives - 1;
    setLives(newLives);
    setVerdict({
      match: false,
      confidence: 1,
      reason: "Tempo esgotado! Tente ser mais rápido na próxima.",
    });
    setFlash("fail");
    setTimeout(() => setFlash(null), 900);
    setPhase(newLives <= 0 ? "gameover" : "result");
  }

  async function fetchChallenge(roundNumber: number, history: string[]) {
    // Dificuldade cresce com o round: 1,1,2,2,3,3,4,4,5,5...
    const difficulty = Math.min(5, Math.ceil(roundNumber / 2));
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: context.trim(),
        difficulty,
        previous: history,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao gerar desafio");
    return data.challenge as string;
  }

  async function startGame() {
    const ctx = context.trim();
    if (!ctx) {
      setError("Descreva onde você está antes de começar.");
      return;
    }
    setError(null);
    setLoadingChallenge(true);
    try {
      const next = await fetchChallenge(1, []);
      setChallenge(next);
      setPreviousChallenges([next]);
      setRound(1);
      setScore(0);
      setLives(MAX_LIVES);
      setVerdict(null);
      setCapturedImage(null);
      setPhase("playing");
      await startCamera();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao iniciar");
    } finally {
      setLoadingChallenge(false);
    }
  }

  async function nextRound() {
    setLoadingChallenge(true);
    setError(null);
    try {
      const newRound = round + 1;
      const next = await fetchChallenge(newRound, previousChallenges);
      setChallenge(next);
      setPreviousChallenges((p) => [...p, next]);
      setRound(newRound);
      setVerdict(null);
      setCapturedImage(null);
      setPhase("playing");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao gerar próximo desafio");
      setPhase("result");
    } finally {
      setLoadingChallenge(false);
    }
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
        setScore((s) => s + 1);
        setFlash("success");
        setTimeout(() => setFlash(null), 900);
        setPhase("result");
      } else {
        const newLives = lives - 1;
        setLives(newLives);
        setFlash("fail");
        setTimeout(() => setFlash(null), 900);
        setPhase(newLives <= 0 ? "gameover" : "result");
      }
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
          <div className="flex items-center gap-2">
            <div className="rounded-2xl border border-border bg-card/60 px-4 py-2 text-right shadow-[var(--shadow-glow)] backdrop-blur">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Acertos
              </div>
              <div className="text-2xl font-black text-primary md:text-3xl">
                {score}
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card/60 px-4 py-2 text-right shadow-[var(--shadow-glow)] backdrop-blur">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Vidas
              </div>
              <div className="text-2xl md:text-3xl tabular-nums" aria-label={`${lives} vidas`}>
                {Array.from({ length: MAX_LIVES }).map((_, i) => (
                  <span key={i} className={i < lives ? "" : "opacity-20 grayscale"}>
                    ❤️
                  </span>
                ))}
              </div>
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
                Você tem <strong>3 vidas</strong>. Cada erro ou tempo esgotado custa uma vida.
              </li>
              <li>
                <span className="mr-2 font-bold text-accent">2.</span>
                A cada round, a IA escolhe um objeto do seu contexto. Você tem 20s para fotografá-lo.
              </li>
              <li>
                <span className="mr-2 font-bold text-accent">3.</span>
                Sua pontuação final é o número de acertos antes de perder as 3 vidas.
              </li>
            </ol>

            <div className="mt-6">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Onde você está? (contexto)
              </label>
              <input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder='ex: "minha cozinha", "sala de aula", "escritório"'
                className="w-full rounded-xl border border-border bg-background/60 px-4 py-3 text-sm outline-none ring-primary/40 transition focus:ring-2"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                A IA vai escolher objetos que provavelmente existem nesse lugar — começando fáceis e ficando mais difíceis a cada round.
              </p>
            </div>

            <Button
              onClick={startGame}
              disabled={loadingChallenge}
              className="mt-6 h-14 w-full rounded-2xl btn-hero text-base font-bold shadow-[var(--shadow-glow)]"
            >
              {loadingChallenge ? "Gerando desafio..." : "Começar caçada ▶"}
            </Button>
            {error && (
              <p className="mt-3 text-center text-sm text-destructive">{error}</p>
            )}
          </section>
        )}

        {/* Playing / Captured / Judging / Result */}
        {phase !== "idle" && phase !== "gameover" && (
          <section className="space-y-4">
            {/* Challenge card */}
            <div className="animate-pop-in rounded-3xl border border-border bg-card/70 p-5 backdrop-blur">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-accent">
                    Round {round} · Encontre
                  </div>
                  <div className="text-lg font-black md:text-2xl">
                    {challenge}
                  </div>
                  <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Contexto: {context}
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
                    disabled={loadingChallenge}
                    className="h-14 flex-1 rounded-2xl btn-hero text-base font-bold shadow-[var(--shadow-glow)]"
                  >
                    {loadingChallenge ? "Gerando..." : "Próximo desafio →"}
                  </Button>
                  <Button
                    onClick={() => {
                      stopCamera();
                      setPhase("idle");
                      setPreviousChallenges([]);
                      setRound(0);
                      setScore(0);
                      setLives(MAX_LIVES);
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

        {/* Game over */}
        {phase === "gameover" && (
          <section className="animate-pop-in rounded-3xl border border-border bg-card/70 p-8 text-center shadow-[var(--shadow-glow-pink)] backdrop-blur md:p-12">
            <div className="text-6xl md:text-7xl">💀</div>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">Fim de jogo</h2>
            <p className="mt-2 text-sm text-muted-foreground md:text-base">
              Você ficou sem vidas.
            </p>
            <div className="mx-auto mt-6 inline-block rounded-2xl border border-border bg-background/60 px-8 py-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Pontuação final
              </div>
              <div className="text-5xl font-black text-primary md:text-6xl">
                {score}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {score === 1 ? "objeto encontrado" : "objetos encontrados"}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button
                onClick={() => {
                  stopCamera();
                  setPhase("idle");
                  setPreviousChallenges([]);
                  setRound(0);
                  setScore(0);
                  setLives(MAX_LIVES);
                  setVerdict(null);
                  setCapturedImage(null);
                }}
                className="h-14 rounded-2xl btn-hero px-8 text-base font-bold shadow-[var(--shadow-glow)]"
              >
                Jogar novamente ↺
              </Button>
            </div>
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-muted-foreground">
          Feito com Lovable · IA de visão via Gemini 2.5 Flash
        </footer>
      </div>
    </main>
  );
}
