/**
 * Shown when a user is signed in but NOT yet approved. They can see nothing of
 * the company until an owner/admin grants access from the Team page. A "check
 * again" button re-fetches the account so a just-approved user gets in without
 * signing out.
 */
import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Button, Card, CardBody, CardHeader } from '../../kit/index.ts';

export function PendingApproval({
  email,
  onRefresh,
  onSignOut,
}: {
  email: string | null;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}): React.JSX.Element {
  const [checking, setChecking] = useState(false);

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      await onRefresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader title="Waiting for approval" />
        <CardBody>
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--lui-accent)]/10 text-[var(--lui-accent)]">
                <Clock size={18} aria-hidden />
              </span>
              <p className="text-[13px] leading-relaxed text-[var(--lui-muted)]">
                You’re signed in{email !== null ? ` as ${email}` : ''}, but your account isn’t approved yet. An owner or
                admin needs to grant you access to this company’s workspace from the <strong>Team</strong> page. As soon
                as they do, everything unlocks here.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button loading={checking} onClick={() => void check()}>
                I’ve been approved — check again
              </Button>
              <Button variant="ghost" onClick={onSignOut}>
                Sign out
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
