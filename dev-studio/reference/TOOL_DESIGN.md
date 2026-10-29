# Development tool design reference

27 October 2026. The user rejected the decorative welcome and alternative mockups, then requested research into real development applications and an implemented tool interface.

## Observed primary references

- [IntelliJ IDEA project opening](https://www.jetbrains.com/help/idea/open-close-and-move-projects.html): Open and Recent Projects are direct project entry actions. [Official project-window screenshot](https://resources.jetbrains.com/help/img/idea/2026.2/project_tw_java_tutorial.png) was visually inspected: compact title/toolbars, a persistent project tree, neutral pane separation and unobtrusive editor shortcuts.
- [Zed project panel](https://zed.dev/docs/project-panel) and its [official screenshot](https://images.zed.dev/docs/project-panel/panel.png): dense file navigation, restrained tabs and an editor occupying most of the window. [Windows and Projects](https://zed.dev/docs/windows-and-projects) documents editor-oriented and agent-oriented panel layouts. [Terminal](https://zed.dev/docs/terminal) describes docked output and multiple terminal instances.
- [VS Code user interface](https://code.visualstudio.com/docs/editing/getting-started/userinterface): files, editor tabs, an optional secondary sidebar, status and bottom panels form a stable working frame.

These are layout/interaction references, not a claim to offer their extension ecosystems or every documented feature.

## Applied decisions

- A real Start/Recent Projects view, with working Open/New/Clone, command palette and diagnostics entry points. No illustrative project data or marketing hero.
- Compact system typography, cool neutral light/dark surfaces, blue focus/selection accents, small consistent controls and file icons.
- Editor space takes priority. Agent work is a remembered optional dock; opening a task or review reveals it. Narrow layouts use Work navigation, and closing the dock restores Files.
- Task reports remain available in expandable sections while the actual diff and checks remain prominent.
- Verification projects live only in disposable candidates. The user's reset application data is preserved during official framework promotion.
