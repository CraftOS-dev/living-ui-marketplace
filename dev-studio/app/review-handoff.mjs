// Submission closes the delivery before the UI offers human acceptance.
// A transport interruption leaves a frozen submission for work-sync to retry.
export async function reviewHandoff(work, { readTask, completeTask }) {
  const taskId = work.task;
  const current = () => work.status === "finalizing" && work.task === taskId;
  if (!current()) return;
  try {
    let task = await readTask(taskId);
    if (!current()) return;
    if (task.status === "working") {
      await completeTask(taskId, {
        status: "completed",
        result: { summary: work.summary },
      });
      task = await readTask(taskId);
    }
    if (!current()) return;
    if (task.status === "completed") {
      work.status = "ready";
      work.finished = new Date().toISOString();
      delete work.handoffError;
    } else if (["failed", "canceled", "pruned"].includes(task.status)) {
      work.status = task.status === "canceled" ? "canceled" : "failed";
      work.handoffError =
        "The agent delivery ended before review was published. Your isolated changes are retained.";
    }
  } catch {
    // Cancellation or a newer delivery must never be overwritten by this retry.
    if (current())
      work.handoffError =
        "Changes are saved. Reconnecting to finish preparing the review.";
  }
}
