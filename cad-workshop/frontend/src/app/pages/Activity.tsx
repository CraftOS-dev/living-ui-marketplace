/**
 * Activity: every batch of changes across all parts, newest first, by you,
 * your AI agent or the app, as dense rows. Any batch reverts in one step.
 */
import { useState } from 'react';
import { ArrowUpRight, History } from 'lucide-react';
import { BatchCard } from '../components/workspace/Panels.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Button, Empty, PageHeader, Panel, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';

type Who = 'all' | 'you' | 'agent';

export function ActivityPage(): React.JSX.Element {
  const [who, setWho] = useState<Who>('all');
  const [pages, setPages] = useState(1);
  const list = useLive(() => api.changes({ actor: who === 'all' ? undefined : who, limit: 30 * pages }), ['changes'], [who, pages]);
  const batches = list.data?.batches ?? [];
  return (
    <div>
      <PageHeader title="Activity" subtitle="Every change to every part. Revert any batch in one step; a revert is a batch too." />
      <div className="mb-3">
        <Segmented<Who>
          label="Who"
          value={who}
          onChange={(v) => {
            setWho(v);
            setPages(1);
          }}
          options={[
            { value: 'all', label: 'Everyone' },
            { value: 'you', label: 'You' },
            { value: 'agent', label: 'Your AI agent' },
          ]}
        />
      </div>
      {list.loading && list.data === null ? (
        <div className="flex justify-center py-16">
          <Spinner size={20} />
        </div>
      ) : batches.length === 0 ? (
        <Panel padded={false}>
          <Empty icon={History} title="No changes yet">
            Changes to parts, by you or your AI agent, appear here.
          </Empty>
        </Panel>
      ) : (
        <Panel padded={false}>
          {batches.map((b) => (
            <BatchCard
              key={b.batch}
              b={b}
              showPart
              actions={
                <>
                  <Button size="sm" variant="ghost" onClick={() => navigate('part', { id: b.part.id })}>
                    Open part <ArrowUpRight size={12} aria-hidden />
                  </Button>
                  <DeleteButton collection="changes" id={b.changes[0]?.id ?? ''} name="this batch" size={24} label="Remove this batch from the history" />
                </>
              }
            />
          ))}
        </Panel>
      )}
      {list.data?.more === true && (
        <div className="mt-3 flex justify-center">
          <Button onClick={() => setPages((p) => p + 1)}>Show older changes</Button>
        </div>
      )}
    </div>
  );
}
