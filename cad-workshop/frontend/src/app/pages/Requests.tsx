/**
 * Requests to your AI agent: designs, fixes and reviews asked from the app,
 * with their status and the agent's answer, as dense rows. A request nobody
 * has picked up says so instead of spinning.
 */
import { useState } from 'react';
import { ArrowUpRight, Inbox, Sparkles } from 'lucide-react';
import { AskAgentDialog, BriefRow } from '../components/AskAgent.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Button, Empty, PageHeader, Panel, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';

type Filter = 'all' | 'open' | 'done';

export function RequestsPage(): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all');
  const [asking, setAsking] = useState(false);
  const list = useLive(() => api.requests({ limit: 200 }), ['briefs', 'parts'], []);
  const all = list.data?.briefs ?? [];
  const rows = all.filter((b) => (filter === 'open' ? b.status === 'sent' || b.status === 'working' : filter === 'done' ? b.status === 'done' || b.status === 'failed' : true));
  return (
    <div>
      <PageHeader
        title="Requests to your AI agent"
        subtitle="Ask from a part to change, fix or review it; ask here to design a new part."
        actions={
          <Button variant="primary" icon={Sparkles} onClick={() => setAsking(true)}>
            Design a new part
          </Button>
        }
      />
      <div className="mb-3">
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Finished' },
          ]}
        />
      </div>
      {list.loading && list.data === null ? (
        <div className="flex justify-center py-16">
          <Spinner size={20} />
        </div>
      ) : rows.length === 0 ? (
        <Panel padded={false}>
          <Empty icon={Inbox} title={filter === 'all' ? 'Nothing asked yet' : 'Nothing here'}>
            Your AI agent designs parts from a description, fixes builds that fail, and reviews parts for 3D printing or machining.
          </Empty>
        </Panel>
      ) : (
        <Panel padded={false}>
          {rows.map((b) => (
            <BriefRow
              key={b.id}
              b={b}
              showPart
              actions={
                <>
                  {b.part !== null && (
                    <Button size="sm" variant="ghost" onClick={() => navigate('part', { id: b.part?.id ?? '' })}>
                      Open {b.part.name} <ArrowUpRight size={12} aria-hidden />
                    </Button>
                  )}
                  <DeleteButton collection="briefs" id={b.id} name="this request" size={24} />
                </>
              }
            />
          ))}
        </Panel>
      )}
      <AskAgentDialog open={asking} onClose={() => setAsking(false)} part={null} selection={[]} failed={false} />
    </div>
  );
}
