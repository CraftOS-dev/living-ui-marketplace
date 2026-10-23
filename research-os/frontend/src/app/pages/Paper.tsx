/** A paper's own page (narrow screens, and papers without a PDF). */
import { ArrowLeft } from 'lucide-react';
import { back } from '../lib/router.ts';
import { PaperPane } from '../components/library/PaperPane.tsx';
import { Button } from '../components/ui.tsx';

export default function PaperPage({ id }: { id: string }): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <div>
        <Button variant="ghost" icon={ArrowLeft} onClick={() => back('library')}>
          Back
        </Button>
      </div>
      <div className="overflow-hidden rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
        <PaperPane id={id} />
      </div>
    </div>
  );
}
