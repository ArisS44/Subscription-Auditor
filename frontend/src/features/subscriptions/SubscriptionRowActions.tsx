import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, MoreHorizontal, Pause, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/features/dashboard/ConfirmDialog';
import {
  useCancelSubscription,
  useDeleteSubscription,
  useUpdateSubscription,
  type Subscription,
} from '@/hooks/useSubscriptions';

/** Per-row edit / cancel / delete. Cancel and delete are guarded by the shared
 *  ConfirmDialog; both mutations invalidate the ['subscriptions', …] prefix, so
 *  the list and analytics refresh automatically. Edit delegates upward to open
 *  the shared add/edit dialog pre-filled with this row. */
export function SubscriptionRowActions({
  subscription,
  accessToken,
  onEdit,
  onDeleted,
}: {
  subscription: Subscription;
  accessToken: string | undefined;
  onEdit: (subscription: Subscription) => void;
  /** Called after a delete is issued — e.g. the detail page navigates back. */
  onDeleted?: () => void;
}) {
  const { t } = useTranslation();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Which status change is awaiting confirmation (null = none).
  const [statusConfirm, setStatusConfirm] = useState<'pause' | 'resume' | 'reactivate' | null>(
    null,
  );
  const cancel = useCancelSubscription(accessToken);
  const remove = useDeleteSubscription(accessToken);
  const update = useUpdateSubscription(accessToken);
  const { status, id, name } = subscription;

  // Status transitions go through PATCH. Reactivating a cancelled row also
  // clears its cancellation date.
  function setStatus(next: 'active' | 'paused', clearCancellation = false) {
    update.mutate({
      id,
      input: clearCancellation ? { status: next, cancellation_date: null } : { status: next },
    });
  }

  function confirmStatusChange() {
    if (statusConfirm === 'pause') setStatus('paused');
    else if (statusConfirm === 'resume') setStatus('active');
    else if (statusConfirm === 'reactivate') setStatus('active', true);
    setStatusConfirm(null);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label={t('subscriptions.actions.menu')} />
          }
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onEdit(subscription)}>
            <Pencil aria-hidden />
            {t('subscriptions.actions.edit')}
          </DropdownMenuItem>

          {status === 'active' && (
            <DropdownMenuItem onClick={() => setStatusConfirm('pause')}>
              <Pause aria-hidden />
              {t('subscriptions.actions.pause')}
            </DropdownMenuItem>
          )}
          {status === 'paused' && (
            <DropdownMenuItem onClick={() => setStatusConfirm('resume')}>
              <Play aria-hidden />
              {t('subscriptions.actions.resume')}
            </DropdownMenuItem>
          )}
          {status === 'cancelled' && (
            <DropdownMenuItem onClick={() => setStatusConfirm('reactivate')}>
              <RotateCcw aria-hidden />
              {t('subscriptions.actions.reactivate')}
            </DropdownMenuItem>
          )}
          {status !== 'cancelled' && (
            <DropdownMenuItem onClick={() => setConfirmCancel(true)}>
              <Ban aria-hidden />
              {t('subscriptions.actions.cancel')}
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 aria-hidden />
            {t('subscriptions.actions.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={statusConfirm !== null}
        onOpenChange={(open) => {
          if (!open) setStatusConfirm(null);
        }}
        title={statusConfirm ? t(`subscriptions.statusDialog.${statusConfirm}.title`) : ''}
        description={
          statusConfirm
            ? t(`subscriptions.statusDialog.${statusConfirm}.description`, { name })
            : ''
        }
        confirmLabel={statusConfirm ? t(`subscriptions.statusDialog.${statusConfirm}.confirm`) : ''}
        cancelLabel={t('subscriptions.statusDialog.cancel')}
        onConfirm={confirmStatusChange}
      />

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('subscriptions.cancelDialog.title')}
        description={t('subscriptions.cancelDialog.description', { name: subscription.name })}
        confirmLabel={t('subscriptions.cancelDialog.confirm')}
        cancelLabel={t('subscriptions.cancelDialog.cancel')}
        onConfirm={() => {
          cancel.mutate({ id: subscription.id });
          setConfirmCancel(false);
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('subscriptions.deleteDialog.title')}
        description={t('subscriptions.deleteDialog.description', { name: subscription.name })}
        confirmLabel={t('subscriptions.deleteDialog.confirm')}
        cancelLabel={t('subscriptions.deleteDialog.cancel')}
        onConfirm={() => {
          remove.mutate(subscription.id);
          setConfirmDelete(false);
          onDeleted?.();
        }}
        destructive
      />
    </>
  );
}
