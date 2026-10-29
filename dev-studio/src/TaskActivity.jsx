import { useEffect, useState } from "react";

export default function TaskActivity({ work, runs }) {
  const [now, setNow] = useState(Date.now());
  const active = ["queued", "running", "finalizing", "canceling"].includes(
    work.status,
  );
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, work.id]);
  if (!work.started) return null;
  const elapsed = Math.max(
    0,
    Math.floor(
      ((work.finished ? Date.parse(work.finished) : now) -
        Date.parse(work.started)) /
        1000,
    ),
  );
  const duration =
    elapsed < 60
      ? `${elapsed}s`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  const run = runs.find(
    (run) => run.work === work.id && run.status === "running",
  );
  let message = work.progress?.at(-1)?.message;
  if (work.status === "queued")
    message = "Waiting for the selected agent to pick up this task.";
  if (work.status === "running" && !message)
    message = "The agent is reading the task and its isolated source.";
  if (run && work.status === "running")
    message = `Running ${run.name}. Actual output is available in Runs.`;
  if (work.status === "finalizing")
    message =
      work.handoffError ||
      "Changes are saved. Preparing your review; editing is locked.";
  if (work.status === "ready")
    message =
      "Your turn: review the changes, then apply them or request a revision.";
  if (work.status === "needs-input")
    message = "The agent needs your answer below to continue.";
  if (!active && !["ready", "needs-input"].includes(work.status)) return null;
  return (
    <div className="task-activity">
      <div>
        <strong>
          {work.status === "ready"
            ? "Your review"
            : work.status === "needs-input"
              ? "Your answer"
              : "Agent activity"}
        </strong>
        <time aria-label="Task elapsed time">
          {duration}
          {active ? " elapsed" : ""}
        </time>
      </div>
      <p role="status">{message}</p>
    </div>
  );
}
