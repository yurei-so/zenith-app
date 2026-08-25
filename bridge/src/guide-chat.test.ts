import { chmod, mkdtemp } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GuideChatClient } from "./guide-chat.js";

const servers: http.Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) =>
  new Promise<void>((resolve) => server.close(() => resolve())))));

async function serve(handler: http.RequestListener) {
  const root = await mkdtemp(join(tmpdir(), "zenith-guide-client-"));
  await chmod(root, 0o700);
  const socketPath = join(root, "runtime.sock");
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => { server.off("error", reject); resolve(); });
  });
  return socketPath;
}

describe("GuideChatClient", () => {
  it("submits only the bounded conversation shape and projects the response", async () => {
    let received: unknown;
    const socket = await serve(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        wake: { metadata: { conversation_id: "00000000-0000-4000-8000-000000000001" } },
        decision: { decision: "allow" }, response: "You are in Queensdale.",
      }));
    });
    const result = await new GuideChatClient(socket).submit(
      "Where am I?", "00000000-0000-4000-8000-000000000001",
    );
    expect(received).toEqual({ agent_id: "zenith-guide", message: "Where am I?",
      conversation_id: "00000000-0000-4000-8000-000000000001" });
    expect(result).toEqual({ conversationId: "00000000-0000-4000-8000-000000000001",
      response: "You are in Queensdale." });
  });

  it("rejects denied and malformed runtime responses", async () => {
    const denied = await serve((_request, response) => response.end(JSON.stringify({
      wake: { metadata: { conversation_id: "00000000-0000-4000-8000-000000000001" } },
      decision: { decision: "deny" }, response: null,
    })));
    await expect(new GuideChatClient(denied).submit("hello")).rejects.toThrow("invalid response");
  });
});
