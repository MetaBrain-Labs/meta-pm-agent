interface StreamWriter {
  write(data: string): Promise<unknown>;
}

export async function writeSse(
  writer: StreamWriter,
  data: unknown,
): Promise<void> {
  await writer.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function writeSseDone(
  writer: StreamWriter,
): Promise<void> {
  await writer.write("data: [DONE]\n\n");
}
