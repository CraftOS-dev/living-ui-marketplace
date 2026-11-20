/**
 * The print frame for '#/print/...' routes (payslips, letters, year-end
 * forms, a person's record): a quiet toolbar (Back, Open in a new tab,
 * Print) that never prints, then the page on a white A4 sheet. Inside the
 * CraftBot frame the browser's print dialog may not open, so "Open in a new
 * tab" comes first there.
 *
 * Module print pages are ordinary routes with frame: 'print' (see
 * routes.tsx); the page renders its content only, and uses <PrintSheet> parts
 * (PrintHead, PrintTable) for a consistent document look.
 */
import type { ReactNode } from 'react';
import { ArrowLeft, ExternalLink, Printer } from 'lucide-react';
import { Button, CompanyLogo } from '../../components/ui.tsx';
import { useMe } from '../../lib/auth.tsx';
import type { RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';

export const routes: RouteDef[] = [];

const framed = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

export function PrintFrame({ children, title }: { children: ReactNode; title: string }): React.JSX.Element {
  return (
    <div className="min-h-[100dvh] bg-[var(--hr-sunk)] text-[var(--hr-ink)] print:bg-white">
      <div className="hr-no-print sticky top-0 z-10 flex h-12 items-center gap-2 border-b border-[var(--hr-line)] bg-[var(--hr-page)] px-3 md:px-5">
        <Button variant="ghost" icon={ArrowLeft} onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.hash = '#/home'))}>
          {t('ui.back')}
        </Button>
        <span className="hr-label min-w-0 flex-1 truncate text-center">{title}</span>
        <Button icon={ExternalLink} variant={framed ? 'primary' : 'default'} onClick={() => window.open(window.location.href, '_blank', 'noopener')}>
          {t('print.new_tab')}
        </Button>
        <Button icon={Printer} variant={framed ? 'default' : 'primary'} onClick={() => window.print()}>
          {t('print.print')}
        </Button>
      </div>
      <div className="px-2 py-4 md:py-8">
        <article className="hr-print-page hr-wrap mx-auto w-full max-w-[210mm] rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-white px-[14mm] py-[16mm] text-[12px] leading-[1.5] text-[#111] shadow-[var(--hr-shadow)]" style={{ minHeight: '297mm', colorScheme: 'light' }}>
          {children}
        </article>
      </div>
    </div>
  );
}

/** The head of a printed document: the company logo (when set, at most 28px tall), the entity as plain text, the document's name, a mono meta line. */
export function PrintHead({ entity, address, title, meta }: { entity: string; address?: string | undefined; title: string; meta?: ReactNode }): React.JSX.Element {
  const me = useMe();
  return (
    <header className="mb-6 flex items-start justify-between gap-6 border-b border-[#bbb] pb-4">
      <div className="min-w-0">
        <CompanyLogo light={me.company.logo} dark={me.company.logo_dark} height={28} alt={me.company.name} print className="mb-2" />
        <div className="text-[15px] font-semibold">{entity}</div>
        {address !== undefined && address !== '' && <div className="mt-0.5 whitespace-pre-line text-[12px] text-[#555]">{address}</div>}
      </div>
      <div className="text-right">
        <div className="text-[15px] font-semibold">{title}</div>
        {meta !== undefined && <div className="hr-mono mt-0.5 text-[10.5px] uppercase tracking-[0.08em] text-[#555]">{meta}</div>}
      </div>
    </header>
  );
}

/** A document table: hairlines, mono right-aligned figures. */
export function PrintTable({ head, rows, foot }: { head: { label: string; right?: boolean | undefined }[]; rows: ReactNode[][]; foot?: ReactNode[] | undefined }): React.JSX.Element {
  return (
    <table className="w-full table-fixed border-collapse text-[12px]">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} className={`hr-mono border-b border-[#999] py-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[#555] ${h.right === true ? 'text-right' : 'text-left'}`}>
              {h.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={`border-b border-[#e3e3e3] py-1.5 align-top ${head[j]?.right === true ? 'hr-mono hr-num text-right' : ''}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {foot !== undefined && (
        <tfoot>
          <tr>
            {foot.map((c, j) => (
              <td key={j} className={`border-t border-[#999] py-1.5 font-semibold ${head[j]?.right === true ? 'hr-mono hr-num text-right' : ''}`}>
                {c}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}
