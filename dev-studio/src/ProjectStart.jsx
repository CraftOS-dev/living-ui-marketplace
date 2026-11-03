import Icon from "./Icon.jsx";

export default function ProjectStart({
  projects,
  onOpen,
  onNew,
  onClone,
  onSelect,
  onCommands,
  onSettings,
  hidden = false,
}) {
  return (
    <main className="project-start" hidden={hidden}>
      <aside className="start-actions" aria-label="Project actions">
        <h1>Start</h1>
        <button onClick={onOpen}>
          <Icon name="folder" />
          <span>Open folder…</span>
          <kbd>Ctrl O</kbd>
        </button>
        <button onClick={onNew}>
          <Icon name="plus" />
          <span>New project…</span>
        </button>
        <button onClick={onClone}>
          <Icon name="branch" />
          <span>Clone repository…</span>
        </button>
        <div className="start-tools">
          <h2>Tools</h2>
          <button onClick={onCommands}>
            <Icon name="search" />
            <span>Command palette</span>
            <kbd>Ctrl P</kbd>
          </button>
          <button onClick={onSettings}>
            <Icon name="settings" />
            <span>Settings</span>
          </button>
        </div>
        <p className="start-local-note">Folders open without running code.</p>
      </aside>
      <section className="start-recents" aria-label="Recent projects">
        <header>
          <h2>Recent projects</h2>
          <span>{projects.length ? projects.length : ""}</span>
        </header>
        <div className="start-column-headings" aria-hidden="true">
          <span>Name</span>
          <span>Location</span>
          <span>Type</span>
        </div>
        {projects.length ? (
          projects.map((project) => (
            <button
              className="start-project-row"
              key={project.id}
              onClick={() => onSelect(project.id)}
              aria-label={"Open " + project.name}
            >
              <span className="start-project-name">
                <Icon name="folder" />
                <strong>{project.name}</strong>
              </span>
              <span className="start-project-path" title={project.root}>
                {project.root}
              </span>
              <span className="start-project-type">
                {project.profile === "javascript"
                  ? "JavaScript"
                  : project.profile === "python"
                    ? "Python"
                    : "Folder"}
              </span>
            </button>
          ))
        ) : (
          <div className="start-no-projects">
            <Icon name="folder" size={18} />
            <div>
              <h3>No recent projects</h3>
              <p>Open a folder or create a project to begin.</p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
