import type {
  ConversationStreamEvent,
  StreamChunk,
} from "../types";

interface TaggedBlockOptions {
  startMarker: string;
  endMarker: string;
  startEvent: "question-form-start" | "user-input-start";
  completeEvent: "question-form-complete" | "user-input-complete";
}

export async function* streamTaggedBlock(
  source: AsyncIterable<StreamChunk>,
  options: TaggedBlockOptions | TaggedBlockOptions[],
): AsyncGenerator<ConversationStreamEvent> {
  const tagOptions = Array.isArray(options) ? options : [options];
  let blockBuffer = "";
  let pendingText = "";
  let collecting = false;
  let activeOptions: TaggedBlockOptions | null = null;

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
        if (!activeOptions) {
          throw new Error("Tagged block collector missing active options.");
        }

        const endIndex = blockBuffer.indexOf(activeOptions.endMarker);
        if (endIndex === -1) {
          break;
        }

        const blockEnd = endIndex + activeOptions.endMarker.length;
        const content = blockBuffer.slice(0, blockEnd);
        pendingText = blockBuffer.slice(blockEnd);
        blockBuffer = "";
        collecting = false;

        yield { type: activeOptions.completeEvent, content };
        activeOptions = null;
        continue;
      }

      const match = findFirstMarker(pendingText, tagOptions);
      if (match) {
        const textBeforeBlock = pendingText.slice(0, match.startIndex);
        if (textBeforeBlock) {
          yield { type: "text", content: textBeforeBlock };
        }

        blockBuffer = pendingText.slice(match.startIndex);
        pendingText = "";
        collecting = true;
        activeOptions = match.options;
        yield { type: match.options.startEvent };
        continue;
      }

      if (!couldEndWithAnyMarkerPrefix(pendingText, tagOptions)) {
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

function couldEndWithAnyMarkerPrefix(
  text: string,
  options: TaggedBlockOptions[],
): boolean {
  return options.some((option) =>
    couldEndWithMarkerPrefix(text, option.startMarker),
  );
}

function findFirstMarker(
  text: string,
  options: TaggedBlockOptions[],
): { startIndex: number; options: TaggedBlockOptions } | null {
  let first: { startIndex: number; options: TaggedBlockOptions } | null =
    null;

  for (const option of options) {
    const startIndex = text.indexOf(option.startMarker);
    if (startIndex === -1) continue;
    if (!first || startIndex < first.startIndex) {
      first = { startIndex, options: option };
    }
  }

  return first;
}
