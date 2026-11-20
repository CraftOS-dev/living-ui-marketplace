/**
 * The kernel's '/' until the home module brings its own route (registry
 * order: a module route for '/' wins). Minimal on purpose: the title and
 * Start.
 */
import { House, Play } from 'lucide-react';
import { navigate } from '../../lib/router.ts';
import { Button, Empty, PageBody, PageHeader } from '../ui.tsx';

export function HomePlaceholder(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Home">
        <Button variant="primary" icon={Play} onClick={() => navigate('/focus')}>
          Start
        </Button>
      </PageHeader>
      <PageBody>
        <Empty icon={House} title="Home" />
      </PageBody>
    </>
  );
}
