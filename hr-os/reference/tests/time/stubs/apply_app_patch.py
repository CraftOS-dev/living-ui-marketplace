# Scratch only: render module publicRoutes before sign-in (proposed to kernel-frontend).
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
if 'publicRoutes' in s:
    print('App.tsx already handles publicRoutes'); sys.exit(0)
s = s.replace("import { allRoutes } from './routes.tsx';", "import { allRoutes, MODULE_EXPORTS } from './routes.tsx';\nimport { matchPath } from './lib/router.ts';\nimport type { RouteDef } from './lib/contract.ts';")
old = """  if (s.phase === 'setup') return <SetupPage />;"""
new = """  if (s.phase === 'setup') return <SetupPage />;
  const pub = publicPage(route.path);
  if (pub !== null) {
    const Page = pub.route.page;
    return <Page params={pub.params} query={route.query} />;
  }"""
assert old in s
s = s.replace(old, new, 1)
s = s.replace("function Screen(): React.JSX.Element {", """/** A module's page that opens before sign-in (the time kiosk), rendered alone. */
function publicPage(path: string): { route: RouteDef; params: Record<string, string> } | null {
  for (const m of Object.values(MODULE_EXPORTS)) {
    for (const r of (m as { publicRoutes?: RouteDef[] | undefined }).publicRoutes ?? []) {
      const params = matchPath(r.path, path);
      if (params !== null) return { route: r, params };
    }
  }
  return null;
}

function Screen(): React.JSX.Element {""", 1)
open(p, 'w', encoding='utf-8').write(s)
print('patched App.tsx (scratch)')
