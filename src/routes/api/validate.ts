import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/validate")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const { image, target } = (await request.json()) as {
            image: string;
            target: string;
          };

          if (!image || !target) {
            return new Response(
              JSON.stringify({ error: "Missing image or target" }),
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
                      "Você é um juiz de um jogo de caça ao tesouro visual. Analise a imagem e decida se ela contém claramente o objeto ou característica pedida. Seja razoável: aceite se o objeto é visível mesmo que parcial. Rejeite se estiver ausente, borrado demais ou ambíguo. Responda SEMPRE via a função submit_verdict.",
                  },
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: `Desafio: "${target}". A imagem mostra isso?`,
                      },
                      { type: "image_url", image_url: { url: image } },
                    ],
                  },
                ],
                tools: [
                  {
                    type: "function",
                    function: {
                      name: "submit_verdict",
                      description: "Retorna o veredito do juiz",
                      parameters: {
                        type: "object",
                        properties: {
                          match: {
                            type: "boolean",
                            description: "true se a imagem atende o desafio",
                          },
                          confidence: {
                            type: "number",
                            description: "0 a 1",
                          },
                          reason: {
                            type: "string",
                            description:
                              "Explicação curta em português (máx 1 frase)",
                          },
                        },
                        required: ["match", "confidence", "reason"],
                        additionalProperties: false,
                      },
                    },
                  },
                ],
                tool_choice: {
                  type: "function",
                  function: { name: "submit_verdict" },
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
          const parsed = JSON.parse(args) as {
            match: boolean;
            confidence: number;
            reason: string;
          };
          return new Response(JSON.stringify(parsed), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("validate error:", e);
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
} as any);