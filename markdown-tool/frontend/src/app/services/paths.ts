/**
 * paths.ts — the workspace's path rules, shared by the explorer
 * (FolderPanel.tsx), the editor (MainView.tsx) and the fetch shim
 * (apiAdapter.ts). pb/pb_hooks/lib_agent.js holds the same rules for agents,
 * with the same messages: a change here must be made there too.
 */

/** Files that open in the editor: names ending in .md or .markdown, any case. */
export function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.md') || lower.endsWith('.markdown')
}

/**
 * Why a new workspace path cannot be used, or null when it can. Paths are
 * workspace-relative and '/'-separated, as V1 required (it refused paths
 * outside the workspace): no backslash, no leading '/', and no empty, '.' or
 * '..' segment.
 */
export function pathProblem(path: string): string | null {
  if (path.includes('\\')) return 'A name cannot contain "\\"'
  if (path.startsWith('/')) return 'A path cannot start with "/"'
  for (const segment of path.split('/')) {
    if (segment === '') return 'A path cannot have an empty name in it ("//" or a "/" at the end)'
    if (segment === '.' || segment === '..') return '"." and ".." cannot be used as names'
  }
  return null
}

/** Why a new name for a file or folder (the Rename dialog) cannot be used, or null. */
export function nameProblem(name: string): string | null {
  if (name.includes('/') || name.includes('\\')) return 'A name cannot contain "/" or "\\"'
  return pathProblem(name)
}

/**
 * Why a new path cannot be used because one of its folders is a file
 * (`notes.md/child.md` under the file `notes.md`), or null. The explorer lists
 * a node only under its folder, so such a node would never be shown.
 * `isFile(dir)` says whether a file (not a folder) has that path.
 */
export function parentProblem(path: string, isFile: (dir: string) => boolean): string | null {
  let dir = path
  while (dir.includes('/')) {
    dir = dir.slice(0, dir.lastIndexOf('/'))
    if (isFile(dir)) return `"${dir}" is a file, not a folder`
  }
  return null
}
