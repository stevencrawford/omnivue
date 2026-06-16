export const workerFactory = () =>
  new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url));
