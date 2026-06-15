import type {
  ConversationStreamEvent,
  StreamChunk,
} from "../types";

interface TaggedBlockOptions {
  startMarker: string;
  endMarker: string;
  startEvent: "question-form-start" | "compress-start";
  completeEvent:
    | "question-form-complete"
    | "compress-complete";
}

export async function* streamTaggedBlock(
  source: AsyncIterable<StreamChunk>,
  options: TaggedBlockOptions,
): AsyncGenerator<ConversationStreamEvent> {
  let blockBuffer = "";
  let pendingText = "";
  let collecting = false;

  for await (const chunk of source) {
    if (chunk.type === "reasoning") {
      yield chunk;
      continue;
    }

    if (collecting) {
      blockBuffer += chunk.content;
    } else {
      pendingText += chunk.content;
    }

    while (true) {
      if (collecting) {
        const endIndex = blockBuffer.indexOf(options.endMarker);
        if (endIndex === -1) {
          break;
        }

        const blockEnd = endIndex + options.endMarker.length;
        const content = blockBuffer.slice(0, blockEnd);
        pendingText = blockBuffer.slice(blockEnd);
        blockBuffer = "";
        collecting = false;

        yield { type: options.completeEvent, content };
        continue;
      }

      const startIndex = pendingText.indexOf(options.startMarker);
      if (startIndex !== -1) {
        const textBeforeBlock = pendingText.slice(0, startIndex);
        if (textBeforeBlock) {
          yield { type: "text", content: textBeforeBlock };
        }

        blockBuffer = pendingText.slice(startIndex);
        pendingText = "";
        collecting = true;
        yield { type: options.startEvent };
        continue;
      }

      if (!couldEndWithMarkerPrefix(
        pendingText,
        options.startMarker,
      )) {
        if (pendingText) {
          yield { type: "text", content: pendingText };
          pendingText = "";
        }
      }
      break;
    }
  }

  if (collecting && blockBuffer) {
    yield { type: "text", content: blockBuffer };
  }
  if (pendingText) {
    yield { type: "text", content: pendingText };
  }
}

function couldEndWithMarkerPrefix(
  text: string,
  marker: string,
): boolean {
  const maxPrefixLength = Math.min(text.length, marker.length - 1);
  for (let length = maxPrefixLength; length > 0; length -= 1) {
    if (text.endsWith(marker.slice(0, length))) {
      return true;
    }
  }
  return false;
}
