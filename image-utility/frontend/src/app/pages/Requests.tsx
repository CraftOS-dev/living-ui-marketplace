/**
 * Requests to your AI agent: what you asked (edits and descriptions), what
 * it is working on, what it answered and what it asks back.
 */
import { useState } from 'react';
import { Inbox } from 'lucide-react';
import { RequestRow } from '../components/Requests.tsx';
import { Empty, PageHeader, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useLive } from '../lib/live.ts';
import type { RequestRec } from '../lib/types.ts';

type Filter = '' | RequestRec['status'];

export function RequestsPage(): React.JSX.Element {
  const [status, setStatus] = useState<Filter>('');
  const list = useLive(() => api.requests({ status, limit: 200 }), ['requests'], [status], 250);
  const rows = list.data?.requests ?? [];
  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title="Requests to your AI agent"
        subtitle="Ask from an image's Agent tab, or select images in the Library to ask for alt text."
        actions={
          <Segmented<Filter>
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'All' },
              { value: 'working', label: 'Working' },
              { value: 'failed', label: 'Needs you' },
              { value: 'done', label: 'Done' },
            ]}
          />
        }
      />
      {list.data === null ? (
        <div className="flex h-40 items-center justify-center text-[var(--iu-muted)]">
          <Spinner size={16} />
        </div>
      ) : rows.length === 0 ? (
        <Empty icon={Inbox} title={status === '' ? 'No requests yet' : 'None here'}>
          Your AI agent edits through the same operations you use: its edits arrive as proposals you accept or reject, and its answers land here.
        </Empty>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {rows.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
