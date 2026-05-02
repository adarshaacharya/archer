export function titleFromTask(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 80);
}
