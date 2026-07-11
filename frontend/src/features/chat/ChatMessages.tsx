import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown';
import type { PendingTurn, StoredMessage } from './types';

// One chat bubble. User turns are plain text (right-aligned, accented); assistant
// turns render sanitized markdown (left-aligned). Structured payloads are shown
// as a small placeholder chip for now — Task 2.2 swaps in the real typed
// chart/table renderers; here we just prove the payload was captured.
function Bubble({
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
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          isUser
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm bg-muted text-foreground',
        )}
      >
        {children}
        {structuredCount > 0 && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground">
            <BarChart3 className="size-3.5" aria-hidden />
            {t('chat.structuredPlaceholder', { count: structuredCount })}
          </div>
        )}
      </div>
    </div>
  );
}

// A blinking caret shown at the tail of the assistant reply while it streams, so
// an in-progress turn reads as live even between token bursts.
function StreamingCaret() {
  return <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-current align-middle" />;
}

export function ChatMessages({
  messages,
  pending,
  loading,
}: {
  messages: StoredMessage[];
  pending: PendingTurn | null;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view as history loads and as tokens stream in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending?.assistantContent, pending?.userContent, pending?.errorMessage]);

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
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-foreground">{t('chat.empty.title')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('chat.empty.body')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
      {visible.map((m) => (
        <Bubble
          key={m.id}
          role={m.role as 'user' | 'assistant'}
          structuredCount={m.structured_payload ? 1 : 0}
        >
          {m.role === 'assistant' ? (
            <Markdown content={m.content ?? ''} />
          ) : (
            <p className="whitespace-pre-wrap">{m.content}</p>
          )}
        </Bubble>
      ))}

      {pending && (
        <>
          <Bubble role="user">
            <p className="whitespace-pre-wrap">{pending.userContent}</p>
          </Bubble>
          <Bubble role="assistant" structuredCount={pending.structured.length}>
            {pending.errorMessage ? (
              <p className="text-sm text-destructive">{pending.errorMessage}</p>
            ) : pending.assistantContent ? (
              <div className="flex items-baseline">
                <Markdown content={pending.assistantContent} />
                {pending.streaming && <StreamingCaret />}
              </div>
            ) : (
              // No text yet: show the tool indicator if a tool is running,
              // otherwise a typing hint.
              <p className="text-sm text-muted-foreground">
                {pending.toolName
                  ? t('chat.usingTool', { tool: pending.toolName })
                  : t('chat.thinking')}
                <StreamingCaret />
              </p>
            )}
          </Bubble>
        </>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
