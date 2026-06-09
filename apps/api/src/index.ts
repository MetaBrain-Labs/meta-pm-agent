import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { stream } from "hono/streaming";
import { z } from "zod";
import { ChatMessage, ChatMessageSchema } from "@repo/shared";
import {
  streamQuestionForm,
  streamCompressConversation,
  streamAgentResponse,
  extractCompressedContext,
  isFormAnswer,
} from "@repo/agent-runtime";

const app = new Hono();

app.use("/*", cors());

// ── Routes ──

app.get("/", (c) => {
  return c.json({ status: "ok" });
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok", agents: ["deepagents-pm-agent"] });
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
});

app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { messages } = parsed.data;
  const lastMsg = messages.at(-1)!;

  c.header("Content-Type", "text/event-stream");
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return stream(c, async (writer) => {
    await writer.write(`data: ${JSON.stringify({ type: "start" })}\n\n`);

    try {
      if (lastMsg.role === "user" && isFormAnswer(lastMsg.content)) {
        console.log("[chat] Form answer detected, streaming compression + response...");

        let fullResponse = "";
        let fullReasoning = "";
        let compressedText = "";

        for await (const chunk of streamCompressConversation(messages)) {
          if (chunk.type === "reasoning") {
            fullReasoning += chunk.content;
            await writer.write(
              `data: ${JSON.stringify({ type: "thinking", content: chunk.content })}\n\n`,
            );
          } else {
            compressedText += chunk.content;
          }
        }

        const compressedContext = extractCompressedContext(compressedText) ?? compressedText;
        console.log("[chat] Compression done, context length:", compressedContext.length);

        for await (const chunk of streamAgentResponse(compressedContext, messages)) {
          if (chunk.type === "reasoning") {
            fullReasoning += chunk.content;
            await writer.write(
              `data: ${JSON.stringify({ type: "thinking", content: chunk.content })}\n\n`,
            );
          } else {
            fullResponse += chunk.content;
            await writer.write(
              `data: ${JSON.stringify({ type: "text", content: chunk.content })}\n\n`,
            );
          }
        }

        console.log("[chat] Stream complete, response length:", fullResponse.length);
      } else {
        console.log("[chat] New intent, streaming question form...");

        const QF_START = "<question-form";
        const QF_END = "</question-form>";
        const QF_PREFIXES = Array.from({ length: QF_START.length }, (_, i) =>
          QF_START.slice(0, i + 1),
        );

        let fullResponse = "";
        let fullReasoning = "";
        let qfState: "normal" | "collecting" = "normal";
        let qfBuffer = "";
        let pendingText = "";

        function mayBePrefix(text: string): boolean {
          return QF_PREFIXES.some((p) => text.endsWith(p));
        }

        for await (const chunk of streamQuestionForm(lastMsg.content)) {
          if (chunk.type === "reasoning") {
            fullReasoning += chunk.content;
            await writer.write(
              `data: ${JSON.stringify({ type: "thinking", content: chunk.content })}\n\n`,
            );
            continue;
          }

          if (qfState === "collecting") {
            qfBuffer += chunk.content;
            const endIdx = qfBuffer.indexOf(QF_END);
            if (endIdx !== -1) {
              const formContent = qfBuffer.slice(0, endIdx + QF_END.length);
              const rest = qfBuffer.slice(endIdx + QF_END.length);
              fullResponse += formContent + rest;
              await writer.write(`data: ${JSON.stringify({ type: "question-form-complete", content: formContent })}\n\n`);
              qfState = "normal";
              qfBuffer = "";
              if (rest) {
                pendingText = rest;
              }
            }
          } else {
            pendingText += chunk.content;

            const qfIdx = pendingText.indexOf(QF_START);
            if (qfIdx !== -1) {
              const before = pendingText.slice(0, qfIdx);
              if (before) {
                fullResponse += before;
                await writer.write(`data: ${JSON.stringify({ type: "text", content: before })}\n\n`);
              }
              qfState = "collecting";
              qfBuffer = pendingText.slice(qfIdx);
              pendingText = "";
              await writer.write(`data: ${JSON.stringify({ type: "question-form-start" })}\n\n`);

              const endIdx = qfBuffer.indexOf(QF_END);
              if (endIdx !== -1) {
                const formContent = qfBuffer.slice(0, endIdx + QF_END.length);
                const rest = qfBuffer.slice(endIdx + QF_END.length);
                fullResponse += formContent + rest;
                await writer.write(`data: ${JSON.stringify({ type: "question-form-complete", content: formContent })}\n\n`);
                qfState = "normal";
                qfBuffer = "";
                if (rest) {
                  pendingText = rest;
                }
              }
            } else if (!mayBePrefix(pendingText)) {
              fullResponse += pendingText;
              await writer.write(`data: ${JSON.stringify({ type: "text", content: pendingText })}\n\n`);
              pendingText = "";
            }
          }
        }

        if (qfState === "collecting" && qfBuffer) {
          fullResponse += qfBuffer;
          await writer.write(`data: ${JSON.stringify({ type: "text", content: qfBuffer })}\n\n`);
        }
        if (pendingText) {
          fullResponse += pendingText;
          await writer.write(`data: ${JSON.stringify({ type: "text", content: pendingText })}\n\n`);
        }

        console.log("[chat] Stream complete, response length:", fullResponse.length);
      }
    } catch (error) {
      console.error("[chat] Error:", error);
      await writer.write(`data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n\n`);
    }

    await writer.write(`data: [DONE]\n\n`);
  });
});

serve({ fetch: app.fetch, port: 3001 });
