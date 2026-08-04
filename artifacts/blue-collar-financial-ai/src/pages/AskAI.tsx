import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, User, Loader2, AlertTriangle, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/lib/store';
import { useAuth } from '@clerk/react';
import { askAI } from '@/lib/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

const SUGGESTED_QUESTIONS = [
  "How much OT do I need to pay off my highest-interest debt in 6 months?",
  "What's my debt-to-income ratio?",
  "How many months of expenses do I have saved?",
  "What would my check be with 20 hours of OT?",
  "Which debt should I pay off first?",
  "Can I afford to take two weeks off?",
  "What happens if I increase my 401(k) contribution to 10%?",
  "What is my best financial move this month?",
];

export default function AskAI() {
  const store = useStore();
  const { getToken } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'intro',
      role: 'assistant',
      content: store.profile
        ? `Hey ${store.profile.name}! I'm Blue Collar AI. Ask me anything about your finances — overtime scenarios, debt payoff, affordability, cash flow. I'll use your confirmed data and show my math.`
        : "Hey! I'm Blue Collar AI. Load your financial data first (via Settings → Load Demo Data or scan your documents), then ask me anything about your finances.",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // AbortController for the current in-flight AI request.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cancel the in-flight request (user pressed the ✕ button).
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    setMessages(prev => prev.map(m =>
      m.loading ? { ...m, content: '_(cancelled)_', loading: false } : m,
    ));
  }, []);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || isLoading) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: q };
    const aiMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', loading: true };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setInput('');
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const token = await getToken().catch(() => null);

    // Guard: Clerk token missing means the session has expired.
    if (!token) {
      setMessages(prev => prev.map(m =>
        m.id === aiMsg.id
          ? { ...m, content: 'Your session has expired. Please reload the page and sign in again.', loading: false }
          : m,
      ));
      setIsLoading(false);
      return;
    }

    try {
      let accumulated = '';
      await askAI(q, (delta) => {
        accumulated += delta;
        setMessages(prev => prev.map(m =>
          m.id === aiMsg.id ? { ...m, content: accumulated, loading: false } : m,
        ));
      }, { token, signal: controller.signal });
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return; // cancelled — already handled
      setMessages(prev => prev.map(m =>
        m.id === aiMsg.id
          ? {
              ...m,
              content: `Sorry, something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}`,
              loading: false,
            }
          : m,
      ));
    } finally {
      abortRef.current = null;
      setIsLoading(false);
    }
  }, [isLoading, store, getToken]);

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] md:h-[calc(100dvh-0rem)] bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-4 py-3 flex items-center gap-3 bg-card">
        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <div className="font-semibold text-foreground text-sm">Blue Collar AI</div>
          <div className="text-xs text-muted-foreground">Uses your confirmed financial data only</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          Not financial advice
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}>
              {msg.role === 'user'
                ? <User className="w-4 h-4" />
                : <Sparkles className="w-4 h-4" />
              }
            </div>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-tr-sm'
                : 'bg-card border border-border text-foreground rounded-tl-sm'
            }`}>
              {msg.loading
                ? <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Calculating…</span>
                  </div>
                : msg.content
              }
            </div>
          </div>
        ))}

        {/* Suggested questions (shown only when idle at start) */}
        {messages.length <= 1 && !isLoading && (
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground px-1">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-left text-xs px-3 py-2 rounded-xl bg-accent hover:bg-primary/10 border border-border hover:border-primary/30 text-foreground transition-colors flex items-center gap-1 group"
                >
                  {q}
                  <ChevronRight className="w-3 h-3 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 border-t border-border p-4 bg-card">
        <form
          className="flex gap-3"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about your pay, debts, overtime…"
            disabled={isLoading}
            className="flex-1 h-12 px-4 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
          />
          {isLoading ? (
            <Button
              type="button"
              onClick={cancel}
              className="h-12 w-12 rounded-xl p-0 bg-red-600 hover:bg-red-700"
              title="Cancel"
            >
              <X className="w-5 h-5" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!input.trim()}
              className="h-12 w-12 rounded-xl p-0 bg-primary hover:bg-primary/90"
            >
              <Send className="w-5 h-5" />
            </Button>
          )}
        </form>
        <p className="text-[10px] text-muted-foreground text-center mt-2">
          Blue Collar AI is not a licensed financial adviser. Always verify important decisions.
        </p>
      </div>
    </div>
  );
}
