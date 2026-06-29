/**
 * DeepSeek V3 Tokenizer 计数工具
 *
 * 基于 DeepSeek 官方 tokenizer.json 在 Node.js 运行时进行本地 token 计数。
 * 当前模块只负责把可见文本与推理文本转换为 BPE token 数，用于校正兼容
 * OpenAI 接口在 usage_metadata 中可能漏报的 completion token。
 *
 * Responsibilities:
 * - 懒加载 DeepSeek V3 tokenizer 资产，避免 Agent 启动时立即解析大 JSON
 * - 按 tokenizer.json 中的 ByteLevel BPE 配置估算文本 token 数
 * - 在解析失败时返回 null，让调用方继续使用 provider usage
 *
 * Notes:
 * - 本模块不负责重新渲染完整 chat_template，因此不覆盖 provider 输入 token。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface TokenizerJson {
  model?: {
    vocab?: Record<string, number>;
    merges?: string[];
  };
  added_tokens?: Array<{ content?: string; id?: number }>;
}

interface TokenizerState {
  vocab: Map<string, number>;
  ranks: Map<string, number>;
  specialTokens: Map<string, number>;
  specialPattern: RegExp | null;
}

const TOKENIZER_PATHS = [
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../assets/deepseek-v3-tokenizer/tokenizer.json",
  ),
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../src/assets/deepseek-v3-tokenizer/tokenizer.json",
  ),
];

const PRE_TOKEN_PATTERN =
  /\p{N}{1,3}|[\u4E00-\u9FA5\u3040-\u309F\u30A0-\u30FF]+|[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~][A-Za-z]+|[^\r\n\p{L}\p{P}\p{S}]?[\p{L}\p{M}]+| ?[\p{P}\p{S}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

let cachedState: TokenizerState | null | undefined;
let byteEncoder: string[] | null = null;

/**
 * 使用 DeepSeek V3 tokenizer 统计文本 token 数。
 */
export function countDeepSeekTokens(text: string): number | null {
  if (!text) return 0;

  const state = loadTokenizerState();
  if (!state) return null;

  let total = 0;
  for (const segment of splitBySpecialTokens(text, state)) {
    if (segment.specialId !== undefined) {
      total += 1;
      continue;
    }

    const pieces = segment.text.match(PRE_TOKEN_PATTERN) ?? [];
    for (const piece of pieces) {
      total += encodePiece(piece, state).length;
    }
  }

  return total;
}

/**
 * 懒加载 tokenizer.json，并构建 BPE rank 表。
 */
function loadTokenizerState(): TokenizerState | null {
  if (cachedState !== undefined) return cachedState;

  try {
    const tokenizerPath = TOKENIZER_PATHS.find((item) => existsSync(item));
    if (!tokenizerPath) {
      cachedState = null;
      return null;
    }

    const json = JSON.parse(readFileSync(tokenizerPath, "utf8")) as TokenizerJson;
    const vocabEntries = Object.entries(json.model?.vocab ?? {});
    const vocab = new Map(vocabEntries);
    const ranks = new Map<string, number>();
    for (const [rank, merge] of (json.model?.merges ?? []).entries()) {
      const [left, right] = merge.split(" ");
      if (left && right) ranks.set(pairKey(left, right), rank);
    }

    const specialTokens = new Map<string, number>();
    for (const token of json.added_tokens ?? []) {
      if (typeof token.content === "string" && typeof token.id === "number") {
        specialTokens.set(token.content, token.id);
      }
    }

    cachedState = {
      vocab,
      ranks,
      specialTokens,
      specialPattern: buildSpecialPattern([...specialTokens.keys()]),
    };
    return cachedState;
  } catch {
    cachedState = null;
    return null;
  }
}

/**
 * 将文本按特殊 token 分段，保证 chat template 标记按单 token 计算。
 */
function splitBySpecialTokens(
  text: string,
  state: TokenizerState,
): Array<{ text: string; specialId?: number }> {
  if (!state.specialPattern) return [{ text }];

  const segments: Array<{ text: string; specialId?: number }> = [];
  let cursor = 0;
  for (const match of text.matchAll(state.specialPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index) });
    }

    const token = match[0];
    segments.push({ text: token, specialId: state.specialTokens.get(token) });
    cursor = index + token.length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return segments;
}

/**
 * 对单个 pre-token 执行 ByteLevel 编码和 BPE 合并。
 */
function encodePiece(piece: string, state: TokenizerState): number[] {
  const symbols = byteLevelEncode(piece).split("");
  if (symbols.length === 0) return [];
  if (symbols.length === 1) {
    return [state.vocab.get(symbols[0]!) ?? 0];
  }

  const merged = applyBpe(symbols, state.ranks);
  return merged.map((token) => state.vocab.get(token) ?? 0);
}

/**
 * 按 rank 从低到高反复合并相邻符号。
 */
function applyBpe(symbols: string[], ranks: Map<string, number>): string[] {
  let current = symbols;

  while (current.length > 1) {
    let bestIndex = -1;
    let bestRank = Number.POSITIVE_INFINITY;

    for (let index = 0; index < current.length - 1; index++) {
      const rank = ranks.get(pairKey(current[index]!, current[index + 1]!));
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank;
        bestIndex = index;
      }
    }

    if (bestIndex === -1) break;

    current = [
      ...current.slice(0, bestIndex),
      current[bestIndex]! + current[bestIndex + 1]!,
      ...current.slice(bestIndex + 2),
    ];
  }

  return current;
}

/**
 * 将 UTF-8 字节映射到 GPT-2/ByteLevel BPE 使用的可见字符空间。
 */
function byteLevelEncode(text: string): string {
  const encoder = getByteEncoder();
  return [...Buffer.from(text, "utf8")].map((byte) => encoder[byte]).join("");
}

/**
 * 构建 HuggingFace ByteLevel 兼容的 byte -> unicode 映射。
 */
function getByteEncoder(): string[] {
  if (byteEncoder) return byteEncoder;

  const bytes: number[] = [];
  for (let byte = 33; byte <= 126; byte++) bytes.push(byte);
  for (let byte = 161; byte <= 172; byte++) bytes.push(byte);
  for (let byte = 174; byte <= 255; byte++) bytes.push(byte);

  const chars = [...bytes];
  let next = 0;
  for (let byte = 0; byte <= 255; byte++) {
    if (bytes.includes(byte)) continue;
    bytes.push(byte);
    chars.push(256 + next);
    next += 1;
  }

  byteEncoder = [];
  for (let index = 0; index < bytes.length; index++) {
    byteEncoder[bytes[index]!] = String.fromCodePoint(chars[index]!);
  }
  return byteEncoder;
}

/**
 * 构建特殊 token 匹配表达式，长 token 优先避免前缀误匹配。
 */
function buildSpecialPattern(tokens: string[]): RegExp | null {
  const sorted = tokens
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  if (sorted.length === 0) return null;

  return new RegExp(sorted.map(escapeRegExp).join("|"), "gu");
}

/**
 * BPE pair 的稳定 key。
 */
function pairKey(left: string, right: string): string {
  return `${left}\u0000${right}`;
}

/**
 * 转义正则字面量。
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
