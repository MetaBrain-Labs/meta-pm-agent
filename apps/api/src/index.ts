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
      // 如果是最后一条信息是用户发起，并且是表单答案提交
      if (lastMsg.role === "user" && isFormAnswer(lastMsg.content)) {
        console.log(
          "[chat] Form answer detected, streaming compression + response...",
        );

        let fullResponse = "";
        let fullReasoning = "";
        let compressedText = "";

        // 表单答案提交后正常步骤为：分析用户的回答以及初始输入，生成提供给后续Agent使用输入，可进行压缩
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

        // 正常情况下，LLM返回的应该是System Prompt要求结构的压缩标签和压缩内容，此时就显示压缩标签内容块，否则全部显示
        const compressedContext =
          extractCompressedContext(compressedText) ?? compressedText;
        console.log(
          "[chat] Compression done, context length:",
          compressedContext.length,
        );

        for await (const chunk of streamAgentResponse(
          compressedContext,
          messages,
        )) {
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

        console.log(
          "[chat] Stream complete, response length:",
          fullResponse.length,
        );
      } else {
        // 否则就是系统发起或者用户发起但是不是表单答案提交
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

        // 生成 Question-Form 收集用户对需求的补充描述
        for await (const chunk of streamQuestionForm(lastMsg.content)) {
          if (chunk.type === "reasoning") {
            fullReasoning += chunk.content;
            await writer.write(
              `data: ${JSON.stringify({ type: "thinking", content: chunk.content })}\n\n`,
            );
            continue;
          }

          // 当没有收到</question-form>时，缓存LLM返回的内容
          if (qfState === "collecting") {
            qfBuffer += chunk.content;
            const endIdx = qfBuffer.indexOf(QF_END);
            if (endIdx !== -1) {
              const formContent = qfBuffer.slice(0, endIdx + QF_END.length);
              const rest = qfBuffer.slice(endIdx + QF_END.length);
              fullResponse += formContent + rest;
              await writer.write(
                `data: ${JSON.stringify({ type: "question-form-complete", content: formContent })}\n\n`,
              );
              qfState = "normal";
              qfBuffer = "";
              if (rest) {
                pendingText = rest;
              }
            }
          } else {
            // 当收到</question-form>后，前端根据缓存内容加载整个Form
            pendingText += chunk.content;

            const qfIdx = pendingText.indexOf(QF_START);
            if (qfIdx !== -1) {
              const before = pendingText.slice(0, qfIdx);
              if (before) {
                fullResponse += before;
                await writer.write(
                  `data: ${JSON.stringify({ type: "text", content: before })}\n\n`,
                );
              }
              qfState = "collecting";
              qfBuffer = pendingText.slice(qfIdx);
              pendingText = "";
              await writer.write(
                `data: ${JSON.stringify({ type: "question-form-start" })}\n\n`,
              );

              const endIdx = qfBuffer.indexOf(QF_END);
              if (endIdx !== -1) {
                const formContent = qfBuffer.slice(0, endIdx + QF_END.length);
                const rest = qfBuffer.slice(endIdx + QF_END.length);
                fullResponse += formContent + rest;
                await writer.write(
                  `data: ${JSON.stringify({ type: "question-form-complete", content: formContent })}\n\n`,
                );
                qfState = "normal";
                qfBuffer = "";
                if (rest) {
                  pendingText = rest;
                }
              }
            } else if (!mayBePrefix(pendingText)) {
              // 找不到 <question-form 的情况下
              fullResponse += pendingText;
              await writer.write(
                `data: ${JSON.stringify({ type: "text", content: pendingText })}\n\n`,
              );
              pendingText = "";
            }
          }
        }

        if (qfState === "collecting" && qfBuffer) {
          fullResponse += qfBuffer;
          await writer.write(
            `data: ${JSON.stringify({ type: "text", content: qfBuffer })}\n\n`,
          );
        }
        if (pendingText) {
          fullResponse += pendingText;
          await writer.write(
            `data: ${JSON.stringify({ type: "text", content: pendingText })}\n\n`,
          );
        }

        console.log(
          "[chat] Stream complete, response length:",
          fullResponse.length,
        );
      }
    } catch (error) {
      console.error("[chat] Error:", error);
      await writer.write(
        `data: ${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n\n`,
      );
    }

    await writer.write(`data: [DONE]\n\n`);
  });
});

serve({ fetch: app.fetch, port: 3001 });
