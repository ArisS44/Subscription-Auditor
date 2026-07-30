import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Check, MessageSquare, PlusCircle, Puzzle, SkipForward, X } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LanguageToggle } from '@/components/LanguageToggle';
import { cn } from '@/lib/utils';
import { ChatView } from '@/features/chat/ChatView';
import { NotificationOptIn } from '@/features/notifications/NotificationOptIn';
import { SubscriptionFormDialog } from '@/features/subscriptions/SubscriptionFormDialog';
import { useOnboarding } from './useOnboarding';
import { ONBOARDING_STEPS, type OnboardingMethod } from './onboarding-state';

// The full-screen onboarding wizard: a top progress rail over a centred card.
// Every step is skippable, the flow resumes from its saved position, and leaving
// (the top-right ✕) returns to the dashboard WITHOUT completing — so the resume
// banner reappears — while only the final step flips onboarding_completed.
export function OnboardingFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const accessToken = session?.access_token;
  const flow = useOnboarding(accessToken);

  function exitToDashboard() {
    navigate('/dashboard');
  }

  async function finish() {
    try {
      await flow.complete();
    } finally {
      // Even if the completion PATCH fails we still leave; the banner will just
      // reappear so nothing is lost.
      navigate('/dashboard');
    }
  }

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="flex items-center gap-4 border-b border-border px-6 py-4">
        <ProgressRail stepIndex={flow.stepIndex} stepCount={flow.stepCount} />
        {/* Inline rather than pinned: the wizard already owns a header bar, so the
            control belongs in it — a fixed corner element would collide with the ✕. */}
        <LanguageToggle />
        <Button
          variant="ghost"
          size="icon"
          onClick={exitToDashboard}
          aria-label={t('onboarding.exit')}
          title={t('onboarding.exit')}
        >
          <X aria-hidden />
        </Button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <StepContent flow={flow} accessToken={accessToken} onFinish={finish} />
      </main>
    </div>
  );
}

// The top rail: one dot per step, filled up to and including the current one.
function ProgressRail({ stepIndex, stepCount }: { stepIndex: number; stepCount: number }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-1 items-center gap-2"
      role="group"
      aria-label={t('onboarding.progress', { current: stepIndex + 1, total: stepCount })}
    >
      {Array.from({ length: stepCount }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-full transition-colors',
            i <= stepIndex ? 'bg-primary' : 'bg-muted',
          )}
          aria-hidden
        />
      ))}
    </div>
  );
}

// A centred step card — the shared frame for every step except the chat setup,
// which needs the full area. Keeps steps visually consistent and understated.
function StepCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function StepContent({
  flow,
  accessToken,
  onFinish,
}: {
  flow: ReturnType<typeof useOnboarding>;
  accessToken: string | undefined;
  onFinish: () => void;
}) {
  switch (flow.step) {
    case 'welcome':
      return <WelcomeStep onNext={flow.goNext} />;
    case 'method':
      return <MethodStep onChoose={flow.chooseMethod} />;
    case 'setup':
      return (
        <SetupStep
          method={flow.method}
          accessToken={accessToken}
          onNext={flow.goNext}
          onBack={flow.goBack}
        />
      );
    case 'extension':
      return (
        <StubStep
          icon={Puzzle}
          titleKey="onboarding.extension.title"
          bodyKey="onboarding.extension.body"
          onNext={flow.goNext}
          onBack={flow.goBack}
        />
      );
    case 'notifications':
      return <NotificationStep onNext={flow.goNext} onBack={flow.goBack} />;
    case 'done':
      return <DoneStep onFinish={onFinish} finishing={flow.completing} />;
  }
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const { t } = useTranslation();
  return (
    <StepCard>
      <div className="flex flex-col gap-3 text-center">
        <h1 className="font-heading text-2xl font-semibold">{t('onboarding.welcome.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('onboarding.welcome.body')}</p>
        <div className="mt-4 flex flex-col gap-2">
          <Button onClick={onNext}>{t('onboarding.welcome.start')}</Button>
        </div>
      </div>
    </StepCard>
  );
}

// The three add-methods. Each is a selectable row; choosing advances to setup.
//
// "skip" is a method like any other and must go through `onChoose` too. It used to
// call a bare "advance" instead, which never recorded the choice: it only looked
// correct because a first-time user's method is null and the setup step's
// fall-through happens to be the reassurance screen. A user who had already picked
// chat, went back, then picked skip advanced with method still 'chat' and landed in
// the assistant instead.
function MethodStep({ onChoose }: { onChoose: (method: OnboardingMethod) => void }) {
  const { t } = useTranslation();
  const methods: { id: OnboardingMethod; icon: typeof MessageSquare }[] = [
    { id: 'chat', icon: MessageSquare },
    { id: 'manual', icon: PlusCircle },
    { id: 'skip', icon: SkipForward },
  ];
  return (
    <StepCard>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-heading text-2xl font-semibold">{t('onboarding.method.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('onboarding.method.body')}</p>
        </div>
        <ul className="flex flex-col gap-2">
          {methods.map(({ id, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onChoose(id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/60"
              >
                <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{t(`onboarding.method.${id}.title`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`onboarding.method.${id}.body`)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </StepCard>
  );
}

function SetupStep({
  method,
  accessToken,
  onNext,
  onBack,
}: {
  method: OnboardingMethod | null;
  accessToken: string | undefined;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);

  // Chat method: the existing assistant in onboarding mode fills the area, with a
  // slim footer to move on. No StepCard — the chat needs the full width/height.
  if (method === 'chat') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 px-6 pt-4">
          <ChatView onboarding />
        </div>
        <StepFooter onBack={onBack} onNext={onNext} nextKey="onboarding.continue" />
      </div>
    );
  }

  if (method === 'manual') {
    return (
      <StepCard>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="font-heading text-2xl font-semibold">{t('onboarding.manual.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('onboarding.manual.body')}</p>
          <div className="mt-2 flex flex-col gap-2">
            <Button onClick={() => setDialogOpen(true)}>
              <PlusCircle aria-hidden />
              {t('onboarding.manual.add')}
            </Button>
          </div>
          <StepFooter onBack={onBack} onNext={onNext} nextKey="onboarding.continue" bare />
        </div>
        <SubscriptionFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          accessToken={accessToken}
        />
      </StepCard>
    );
  }

  // Skipped adding — a short reassurance, then continue.
  return (
    <StepCard>
      <div className="flex flex-col gap-4 text-center">
        <h1 className="font-heading text-2xl font-semibold">{t('onboarding.skip.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('onboarding.skip.body')}</p>
        <StepFooter onBack={onBack} onNext={onNext} nextKey="onboarding.continue" bare />
      </div>
    </StepCard>
  );
}

// A "coming soon" step for a feature that ships later (extension, push). Honest
// placeholder — the tab's icon, muted copy, a "coming soon" badge — no dead
// controls, matching the app's existing ComingSoonPage treatment.
function StubStep({
  icon: Icon,
  titleKey,
  bodyKey,
  onNext,
  onBack,
}: {
  icon: typeof Bell;
  titleKey: string;
  bodyKey: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StepCard>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-5">
          <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <h1 className="font-heading text-lg font-semibold">{t(titleKey)}</h1>
              <Badge variant="outline">{t('dashboard.comingSoon.badge')}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{t(bodyKey)}</p>
          </div>
        </div>
        <StepFooter onBack={onBack} onNext={onNext} nextKey="onboarding.continue" bare />
      </div>
    </StepCard>
  );
}

// The notification opt-in step. The opt-in is offered unconditionally: granting
// notification permission is a browser-level act that does not depend on having
// any subscriptions yet, and a user who enables reminders during setup should not
// have to come back to Settings after adding their first subscription. Continue
// always advances, so declining never blocks finishing onboarding.
function NotificationStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();

  return (
    <StepCard>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="font-heading text-2xl font-semibold">
            {t('onboarding.notifications.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('onboarding.notifications.body')}</p>
        </div>

        {/* `bare`: this step's own heading and body already introduce reminders, so
            the card's description would repeat them almost verbatim. */}
        <NotificationOptIn bare />

        <StepFooter onBack={onBack} onNext={onNext} nextKey="onboarding.continue" bare />
      </div>
    </StepCard>
  );
}

function DoneStep({ onFinish, finishing }: { onFinish: () => void; finishing: boolean }) {
  const { t } = useTranslation();
  return (
    <StepCard>
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Check className="size-6" aria-hidden />
        </span>
        <h1 className="font-heading text-2xl font-semibold">{t('onboarding.done.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('onboarding.done.body')}</p>
        <div className="mt-4 flex w-full flex-col gap-2">
          <Button onClick={onFinish} disabled={finishing}>
            {t('onboarding.done.finish')}
          </Button>
        </div>
      </div>
    </StepCard>
  );
}

// Shared Back / Continue controls. `bare` drops the top border+padding for use
// inside a centred card; the chat step uses the bordered footer variant.
//
// There is deliberately no Skip button here: it was wired to the same `onNext` as
// Continue on every step, so it offered no distinct action and only added noise.
// (The method step's separate "skip" card is a different thing — it routes to the
// reassurance screen rather than advancing.)
function StepFooter({
  onBack,
  onNext,
  nextKey,
  bare = false,
}: {
  onBack: () => void;
  onNext: () => void;
  nextKey: string;
  bare?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2',
        bare ? 'mt-2' : 'border-t border-border px-6 py-3',
      )}
    >
      <Button variant="ghost" onClick={onBack}>
        {t('onboarding.back')}
      </Button>
      <Button onClick={onNext}>{t(nextKey)}</Button>
    </div>
  );
}

// Re-export so the route module and tests can reference the step list.
export { ONBOARDING_STEPS };
