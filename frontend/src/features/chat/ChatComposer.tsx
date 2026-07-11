import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SendHorizonal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

// The message input. Enter sends, Shift+Enter inserts a newline (standard chat
// convention). Sending is blocked while a reply is streaming and for empty/
// whitespace-only input. The 8000-char cap mirrors the backend ChatMessageRequest
// bound so the UI never lets the user compose something the API will reject.
const MAX_LEN = 8000;

export function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;

  function submit() {
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border bg-background p-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, MAX_LEN))}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={t('chat.composer.placeholder')}
        aria-label={t('chat.composer.placeholder')}
        className="max-h-40 min-h-9 flex-1 resize-none"
      />
      <Button
        type="button"
        size="icon"
        onClick={submit}
        disabled={!canSend}
        aria-label={t('chat.composer.send')}
        title={t('chat.composer.send')}
      >
        <SendHorizonal aria-hidden />
      </Button>
    </div>
  );
}
