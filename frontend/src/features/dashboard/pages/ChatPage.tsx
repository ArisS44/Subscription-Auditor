import { ChatView } from '@/features/chat/ChatView';

/** Chat tab route. The chat UI fills the dashboard content area (its own sidebar
 *  + message pane), so it manages its own height rather than the usual stacked
 *  page layout. */
export function ChatPage() {
  return (
    <div className="h-full min-h-0">
      <ChatView />
    </div>
  );
}
