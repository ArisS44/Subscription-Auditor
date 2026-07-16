import { useTranslation } from 'react-i18next';
import { BarChart3 } from 'lucide-react';
import { ChatChart } from './ChatChart';
import { ChatTable } from './ChatTable';
import { classifyStructured } from './structured';

// Dispatches one grounded `structured` payload to the right typed renderer,
// detecting chart vs. table by shape (see structured.ts). A payload matching
// neither — which the backend's validation should prevent — falls back to the
// old placeholder chip rather than throwing, so an unexpected shape degrades
// instead of taking the whole reply down.
export function StructuredPayload({ payload }: { payload: Record<string, unknown> }) {
  const { t } = useTranslation();
  const result = classifyStructured(payload);

  if (result.kind === 'chart') return <ChatChart payload={result.payload} />;
  if (result.kind === 'table') return <ChatTable payload={result.payload} />;

  return (
    <div className="my-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-muted-foreground">
      <BarChart3 className="size-3.5" aria-hidden />
      {t('chat.structuredUnavailable')}
    </div>
  );
}
