import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Clock, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';
import type { ChatFailureReason, PendingTurn, StoredMessage } from './types';

// Failures the user can simply retry (a cap they'll age out of, or the provider
// being momentarily busy) read as a calm "try again shortly" notice. Everything
// else is a genuine fault and gets the destructive treatment. Splitting on this
// keeps a transient blip from looking like the app broke.
const TRANSIENT_REASONS: ReadonlySet<ChatFailureReason> = new Set([
  'rate',
  'global_daily',
  'rate_limited',
]);

// A turn that ended in a graceful failure. The copy is resolved here, at render
// time, from the backend's machine tag — so it honours the active language and
// never shows provider-internal wording.
function TurnError({ reason }: { reason: ChatFailureReason }) {
  const { t } = useTranslation();
  const transient = TRANSIENT_REASONS.has(reason);
  const Icon = transient ? Clock : TriangleAlert;
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2 text-sm',
        transient ? 'text-muted-foreground' : 'text-destructive',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{t(`chat.error.${reason}`)}</span>
    </div>
  );
}

// One turn in the transcript. The two roles are deliberately asymmetric: a user
// turn is a compact right-aligned bubble (short, and the bubble marks it as
// "mine"), while an assistant turn runs open and full-width with no background.
// The assistant carries the long-form payload — markdown prose, and the charts
// and tables Task 2.2 renders — which a width-capped tinted box would cramp;
// unbubbled gives that content the whole column. Structured payloads show as a
// placeholder chip until those typed renderers land.
function Turn({
  role,
  children,
  structuredCount = 0,
}: {
  role: 'user' | 'assistant';
  children: React.ReactNode;
  structuredCount?: number;
}) {
  const { t } = useTranslation();
  const isUser = role === 'user';

  const payloadChip = structuredCount > 0 && (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground">
      <BarChart3 className="size-3.5" aria-hidden />
      {t('chat.structuredPlaceholder', { count: structuredCount })}
    </div>
  );

  if (!isUser) {
    return (
      <div className="w-full text-sm text-foreground">
        {children}
        {payloadChip}
      </div>
    );
  }

  return (
    <div className="flex w-full justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        {children}
        {payloadChip}
      </div>
    </div>
  );
}

// A blinking caret shown at the tail of the assistant reply while it streams, so
// an in-progress turn reads as live even between token bursts.
function StreamingCaret() {
  return <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-middle" />;
}

// What the assistant is doing before any text arrives. A turn can invoke several
// tools (e.g. get_analytics then render_table), so we show each in arrival order
// rather than only the newest — the trail explains a slow turn. Labels come from
// `chat.tool.<name>` keys: the registry's internal names are never shown to the
// user, and an unmapped/new tool falls back to neutral generic copy.
function ToolTrail({ toolNames }: { toolNames: string[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-1">
      {toolNames.map((name, index) => {
        const active = index === toolNames.length - 1;
        return (
          <li
            key={`${name}-${index}`}
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <span>{t([`chat.tool.${name}`, 'chat.tool.fallback'])}</span>
            {active && <StreamingCaret />}
          </li>
        );
      })}
    </ul>
  );
}

// Starter prompts for an empty chat. Each is a real question the tool registry
// can actually answer — they double as documentation of what the assistant does,
// which a blank pane cannot convey. The copy itself lives in the locale files.
const EXAMPLE_PROMPT_KEYS = ['monthly', 'cutBack', 'byCategory'] as const;

export function ChatMessages({
  messages,
  pending,
  loading,
  onExampleSelect,
}: {
  messages: StoredMessage[];
  pending: PendingTurn | null;
  loading: boolean;
  onExampleSelect: (prompt: string) => void;
}) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view as history loads and as tokens stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending?.assistantContent, pending?.userContent, pending?.errorReason]);

  // Only user/assistant turns are shown; tool/system rows are internal engine
  // bookkeeping. An assistant row with no text and no structured payload (a pure
  // tool-call turn) is skipped.
  const visible = messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') &&
      ((m.content?.trim().length ?? 0) > 0 || m.structured_payload != null),
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('chat.loadingHistory')}
      </div>
    );
  }

  const empty = visible.length === 0 && !pending;
  if (empty) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium text-foreground">{t('chat.empty.title')}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t('chat.empty.body')}</p>
        </div>
        <ul className="flex w-full max-w-sm flex-col gap-1.5">
          {EXAMPLE_PROMPT_KEYS.map((key) => {
            const prompt = t(`chat.empty.examples.${key}`);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onExampleSelect(prompt)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/60 hover:text-foreground"
                >
                  {prompt}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
      {visible.map((m) => (
        <Turn
          key={m.id}
          role={m.role as 'user' | 'assistant'}
          structuredCount={m.structured_payload ? 1 : 0}
        >
          {m.role === 'assistant' ? (
            <Markdown content={m.content ?? ''} />
          ) : (
            <p className="whitespace-pre-wrap">{m.content}</p>
          )}
        </Turn>
      ))}

      {pending && (
        <>
          <Turn role="user">
            <p className="whitespace-pre-wrap">{pending.userContent}</p>
          </Turn>
          <Turn role="assistant" structuredCount={pending.structured.length}>
            {pending.errorReason ? (
              <TurnError reason={pending.errorReason} />
            ) : pending.assistantContent ? (
              <div className="flex items-baseline">
                <Markdown content={pending.assistantContent} />
                {pending.streaming && <StreamingCaret />}
              </div>
            ) : pending.toolNames.length > 0 ? (
              // No text yet, but tools are running — show what they are.
              <ToolTrail toolNames={pending.toolNames} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('chat.thinking')}
                <StreamingCaret />
              </p>
            )}
          </Turn>
        </>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
