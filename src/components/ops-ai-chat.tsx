"use client";

import { FormEvent, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string };

export function OpsAiChat() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<any>(null);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || loading) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setQuestion("");
    setLoading(true);
    const result = await fetch("/api/ops-pulse/ai-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: text,
        context: window.location.pathname,
        history: messages.slice(-6)
      })
    }).then((response) => response.json()).catch(() => ({ error: "Unable to reach Ops AI." }));
    setMessages((current) => [...current, { role: "assistant", text: result.answer || result.error || "No answer returned." }]);
    setLoading(false);
  }

  function dictate() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setMessages((current) => [...current, { role: "assistant", text: "Voice typing is not supported in this browser. You can type the question." }]); return; }
    if (listening && recognition.current) { recognition.current.stop(); return; }
    const instance = new SpeechRecognition();
    instance.lang = "en-IN";
    instance.interimResults = true;
    instance.continuous = false;
    instance.onresult = (event: any) => setQuestion(Array.from(event.results).map((result: any) => result[0].transcript).join(""));
    instance.onstart = () => setListening(true);
    instance.onend = () => setListening(false);
    instance.onerror = () => setListening(false);
    recognition.current = instance;
    instance.start();
  }

  return <div className={`ops-ai ${open ? "open" : ""}`}>
    {open ? <section className="ops-ai-panel"><header><div><span>DROPX</span><strong>Ops AI</strong></div><button type="button" onClick={() => setOpen(false)} aria-label="Close Ops AI">×</button></header>
      <div className="ops-ai-messages">{!messages.length ? <div className="ops-ai-welcome"><b>Ask about your permitted operations.</b><span>Try “What is GDRD SPR?”, “How many active DAs are in my stations?” or “Which station is above CPS target?”</span></div> : null}{messages.map((message, index) => <div key={index} className={message.role}>{message.text}</div>)}{loading ? <div className="assistant loading">Checking live data…</div> : null}</div>
      <form onSubmit={ask}><button className={listening ? "listening" : ""} type="button" onClick={dictate} aria-label="Voice typing">◉</button><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={listening ? "Listening…" : "Ask Ops AI"}/><button type="submit" disabled={!question.trim() || loading}>↑</button></form>
    </section> : null}
    <button className="ops-ai-launcher" type="button" onClick={() => setOpen((value) => !value)} aria-label="Open Ops AI">{open ? "×" : "AI"}</button>
  </div>;
}
