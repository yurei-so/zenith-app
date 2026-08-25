import http from "node:http";

const MAX_RESPONSE_BYTES = 256 * 1024;

export interface GuideTurnResult {
  conversationId: string;
  response: string;
}

export class GuideChatClient {
  constructor(
    private readonly socketPath: string,
    private readonly agentId = "zenith-guide",
  ) {
    if (!socketPath.startsWith("/")) throw new Error("Guide chat socket path must be absolute");
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(agentId)) throw new Error("Invalid guide agent ID");
  }

  submit(message: string, conversationId?: string): Promise<GuideTurnResult> {
    const body = Buffer.from(JSON.stringify({
      agent_id: this.agentId,
      message,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }));
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath: this.socketPath,
        method: "POST",
        path: "/v1/conversations",
        headers: { "content-type": "application/json", "content-length": body.byteLength },
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error("Guide response exceeded its size limit"));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          if (response.statusCode !== 200) {
            reject(new Error(`Guide runtime returned HTTP ${response.statusCode}`));
            return;
          }
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
            resolve(parseRuntimeResult(result));
          } catch {
            reject(new Error("Guide runtime returned an invalid response"));
          }
        });
      });
      request.setTimeout(120_000, () => request.destroy(new Error("Guide runtime timed out")));
      request.on("error", reject);
      request.end(body);
    });
  }
}

function parseRuntimeResult(value: unknown): GuideTurnResult {
  if (!value || typeof value !== "object") throw new Error("Invalid guide result");
  const result = value as Record<string, unknown>;
  const wake = result.wake as Record<string, unknown> | undefined;
  const metadata = wake?.metadata as Record<string, unknown> | undefined;
  const decision = result.decision as Record<string, unknown> | undefined;
  if (decision?.decision !== "allow" || typeof result.response !== "string" || !result.response.trim()) {
    throw new Error("Guide turn was not completed");
  }
  const conversationId = metadata?.conversation_id;
  if (typeof conversationId !== "string" || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
    throw new Error("Guide result omitted its conversation ID");
  }
  return { conversationId, response: result.response };
}
