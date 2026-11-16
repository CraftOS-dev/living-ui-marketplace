/**
 * Page actions that fit a phone: text buttons sit in the page header from
 * 768px up and in a row at the top of the page body below it, so a phone
 * header keeps room for its title. Small icon menus stay in the header.
 */
import type { ReactNode } from 'react';

/** In the PageHeader: shown from md up. */
export function Acts({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="hidden md:contents">{children}</span>;
}

/** At the top of the PageBody: shown below md. */
export function PhoneActs({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="mb-3 flex flex-wrap items-center gap-2 md:hidden">{children}</div>;
}
