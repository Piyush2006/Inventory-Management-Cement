"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { actionAskBruce } from "@/app/actions";

const SUGGESTED_QUESTIONS = [
  "Which materials are below minimum stock?",
  "What did we consume yesterday?",
  "Show me pending requests and delays",
  "Why is OPC 43 showing critical?",
  "Which materials are approaching minimum stock?",
];

type Turn = { question: string; text: string; links: { label: string; href: string }[] };

export function BruceChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuestion("");
    const fd = new FormData();
    fd.set("question", trimmed);
    startTransition(async () => {
      const res = await actionAskBruce(fd);
      setTurns((prev) => [...prev, { question: trimmed, text: res.ok ? res.text : res.error, links: res.ok ? res.links : [] }]);
    });
  }

  return (
    <div className="shadow-panel rounded-lg border border-border bg-surface p-4">
      {turns.length > 0 && (
        <div className="mb-3 max-h-80 space-y-3 overflow-y-auto scrollbar-thin pr-1">
          {turns.map((t, i) => (
            <div key={i} className="space-y-1.5">
              <div className="rounded-md bg-accent-soft px-2.5 py-1.5 text-xs text-foreground">{t.question}</div>
              <div className="rounded-md bg-surface-raised px-2.5 py-1.5 text-xs text-foreground">
                <p className="whitespace-pre-line">{t.text}</p>
                {t.links.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {t.links.map((l) => (
                      <Link key={l.href} href={l.href} className="rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent hover:underline">
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {pending && <div className="text-[11px] text-muted-soft">Bruce AI is thinking…</div>}
        </div>
      )}

      <p className="mb-1.5 text-xs font-medium text-muted">Suggested questions</p>
      <div className="mb-3 flex flex-col gap-1.5">
        {SUGGESTED_QUESTIONS.map((sq) => (
          <button
            key={sq}
            type="button"
            onClick={() => ask(sq)}
            disabled={pending}
            className="rounded-md border border-border-soft bg-surface-raised px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:border-accent/40 hover:text-foreground disabled:opacity-40"
          >
            {sq}
          </button>
        ))}
      </div>

      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
      >
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question about your inventory…"
          disabled={pending}
          className="block w-full rounded-md border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4Z" />
          </svg>
        </button>
      </form>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-soft">Bruce AI uses your system data. Responses may vary. Always verify critical information.</p>
    </div>
  );
}
