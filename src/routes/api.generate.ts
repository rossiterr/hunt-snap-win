import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { context, difficulty, previous } = (await request.json()) as {
            context: string;
            difficulty: number; // 1 (fácil) a 5 (difícil)
            previous?: string[];
          };

          if (!context) {
            return new Response(
              JSON.stringify({ error: "Missing context" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            );
          }

          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(
              JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const level = Math.max(1, Math.min(5, difficulty || 1));
          const levelDescription = [
            "muito fácil — algo extremamente comum e visível imediatamente nesse contexto",
            "fácil — algo comum, esperado nesse contexto",
            "médio — algo plausível mas que exige procurar um pouco",
            "difícil — algo que provavelmente existe, mas é menos óbvio (detalhe específico, cor incomum, item secundário)",
            "muito difícil — algo bem específico ou raro, mas que ainda faz sentido existir nesse contexto",
          ][level - 1];

          const prevList = (previous || []).slice(-10).join(", ");

          const res = await fetch(
            "https://ai.gateway.lovable.dev/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "google/gemini-2.5-flash",
                messages: [
                  {
                    role: "system",
                    content:
                      "Você gera desafios para um jogo de caça ao tesouro com câmera. Dado o CONTEXTO do jogador (onde ele está) e o NÍVEL de dificuldade, sugira UM objeto/coisa que ele deve fotografar. REGRAS: (1) o objeto DEVE ser plausível de existir nesse contexto — nunca peça algo que ninguém teria nesse lugar. (2) Quanto maior a dificuldade, mais específico/menos óbvio, mas SEMPRE ainda plausível. (3) Texto curto em português, em minúsculas, começando com artigo (ex: 'uma caneca', 'algo verde', 'um cabo usb'). (4) Não repita itens já pedidos. Responda SEMPRE via a função submit_challenge.",
                  },
                  {
                    role: "user",
                    content: `Contexto: "${context}". Nível de dificuldade: ${level}/5 (${levelDescription}). Já pedidos (não repita): ${prevList || "nenhum"}.`,
                  },
                ],
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "submit_challenge",
                      description: "Retorna o próximo desafio",
                      parameters: {
                        type: "object",
                        properties: {
                          challenge: {
                            type: "string",
                            description:
                              "O objeto/coisa a fotografar, curto e em português",
                          },
                        },
                        required: ["challenge"],
                        additionalProperties: false,
                      },
                    },
                  },
                ],
                tool_choice: {
                  type: "function",
                  function: { name: "submit_challenge" },
                },
              }),
            },
          );

          if (!res.ok) {
            const text = await res.text();
            console.error("AI gateway error:", res.status, text);
            if (res.status === 429) {
              return new Response(
                JSON.stringify({ error: "Muitas requisições. Aguarde um instante." }),
                { status: 429, headers: { "Content-Type": "application/json" } },
              );
            }
            if (res.status === 402) {
              return new Response(
                JSON.stringify({ error: "Créditos do Lovable AI esgotados." }),
                { status: 402, headers: { "Content-Type": "application/json" } },
              );
            }
            return new Response(
              JSON.stringify({ error: "Falha ao consultar IA" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }

          const data = await res.json();
          const call = data?.choices?.[0]?.message?.tool_calls?.[0];
          const args = call?.function?.arguments;
          if (!args) {
            return new Response(
              JSON.stringify({ error: "Resposta inválida da IA" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          const parsed = JSON.parse(args) as { challenge: string };
          return new Response(JSON.stringify(parsed), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("generate error:", e);
          return new Response(
            JSON.stringify({
              error: e instanceof Error ? e.message : "Erro desconhecido",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});