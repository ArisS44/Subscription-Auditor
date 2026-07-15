import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatShortDateTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/features/dashboard/ConfirmDialog';
import type { Conversation } from './types';

// The conversation-history sidebar: a "new chat" action plus the list of past
// conversations. The active one is highlighted; each row can be deleted behind a
// confirmation dialog (deletion cascades to messages server-side and is not
// undoable).
//
// A conversation is auto-titled from its first message, so a row lacking a title
// is the rare case where titling hasn't landed yet or failed. Those fall back to
// their creation time rather than a fixed word: several untitled rows stay
// distinguishable from each other, and the label can't be misread as the "New
// chat" button.
export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);

  const rowLabel = (conv: Conversation) =>
    conv.title ??
    t('chat.sidebar.untitledAt', { when: formatShortDateTime(conv.created_at, i18n.language) });

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="p-3">
        <Button onClick={onNew} className="w-full" variant="outline">
          <Plus aria-hidden />
          {t('chat.sidebar.new')}
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label={t('chat.sidebar.heading')}>
        {loading ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{t('chat.sidebar.loading')}</p>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">{t('chat.sidebar.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId;
              return (
                <li key={conv.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => onSelect(conv.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-2 pr-8 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <MessageSquare className="size-4 shrink-0 opacity-70" aria-hidden />
                    <span className="truncate">{rowLabel(conv)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(conv)}
                    aria-label={t('chat.sidebar.delete')}
                    title={t('chat.sidebar.delete')}
                    className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('chat.deleteDialog.title')}
        description={t('chat.deleteDialog.body')}
        confirmLabel={t('chat.deleteDialog.confirm')}
        cancelLabel={t('chat.deleteDialog.cancel')}
        destructive
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </aside>
  );
}
