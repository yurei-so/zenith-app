import { FormEvent, useEffect, useRef, useState } from "react";

type GuideMessage = { id: string; role: "user" | "guide"; text: string };
type GuideResponse = { conversationId: string; response: string };

const API_ROOT = "http://127.0.0.1:38421";

export function GuidePanel() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<GuideMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;
    setDraft("");
    setError(null);
    setPending(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text: message }]);
    try {
      const response = await fetch(`${API_ROOT}/api/guide/turn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
      });
      if (!response.ok) throw new Error("Guide unavailable");
      const result = await response.json() as GuideResponse;
      if (!result.response || !result.conversationId) throw new Error("Invalid guide response");
      setConversationId(result.conversationId);
      setMessages((current) => [...current, {
        id: crypto.randomUUID(), role: "guide", text: result.response,
      }]);
    } catch {
      setError("Zenith Guide couldn’t answer right now. Your map and telemetry are still available.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <button className="guide-launcher" onClick={() => setOpen(true)} aria-label="Open Zenith Guide">
      <span>Z</span><strong>Ask Zenith</strong>
    </button>;
  }

  return <section className="guide-panel" aria-label="Zenith Guide">
    <header>
      <div className="guide-identity"><span>Z</span><div><strong>Zenith Guide</strong><small>Live situational companion</small></div></div>
      <button onClick={() => setOpen(false)} aria-label="Close Zenith Guide">×</button>
    </header>
    <div className="guide-messages" aria-live="polite">
      {messages.length === 0 && <div className="guide-welcome">
        <strong>I’m oriented.</strong>
        <p>Ask where you are, what map reference is nearby, or what the current scene indicates.</p>
      </div>}
      {messages.map((message) => <div key={message.id} className={`guide-message is-${message.role}`}>
        {message.text}
      </div>)}
      {pending && <div className="guide-thinking"><i /><i /><i /><span>Reading the scene…</span></div>}
      {error && <div className="guide-error">{error}</div>}
      <div ref={endRef} />
    </div>
    <form onSubmit={submit}>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }}
        placeholder="Ask about the current scene…" maxLength={4000} rows={2} disabled={pending} />
      <button type="submit" disabled={pending || !draft.trim()} aria-label="Send message">↑</button>
    </form>
  </section>;
}
