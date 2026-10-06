/**
 * Navigation is the URL: every screen, and every level of detail inside it,
 * is its own hash path, so drilling in is a link and the browser's Back works.
 *
 *   home                      Home
 *   score                     Home › Security score
 *   activity[/changes|/actions]
 *   app/<id>[/<part>]         Home › <app> › Who can reach it / Updates / Backups / …
 *   item/<id>[/<part>]        Home › <item> › Everything we see / History / …
 *   issue/<id>[/technical]    Home › <item> › <issue> › Technical details
 *   fix/<id>[/technical]      Home › <item> › <issue> › Fix › Technical details
 *   issues[/cases|/fixes|/handled|/all]
 *   case/<id>[/technical]
 *   protected[/all]
 *   settings/<tab>            (advanced tabs sit under Settings › More settings)
 *   setup
 */
export function go(path: string): void {
  window.location.hash = '/' + path;
}

export function href(path: string): string {
  return '#/' + path;
}

export const to = {
  app: (id: string, part?: string): string => 'app/' + id + (part ? '/' + part : ''),
  // v4: the server is the only item; its parts are tabs (history, …)
  item: (_id: string, part?: string): string => 'server' + (part === 'history' ? '/history' : ''),
  issue: (id: string, technical = false): string => 'issue/' + id + (technical ? '/technical' : ''),
  fix: (id: string, technical = false): string => 'fix/' + id + (technical ? '/technical' : ''),
  case: (id: string, technical = false): string => 'case/' + id + (technical ? '/technical' : ''),
};
