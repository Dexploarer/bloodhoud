import { parentPort, workerData } from "node:worker_threads";
import { scanProject } from "./project-scan.ts";

scanProject(workerData.input, (progress) => {
  postMessage({ type: "progress", payload: progress });
})
  .then((result) => {
    postMessage({ type: "complete", payload: result });
  })
  .catch((error) => {
    postMessage({
      type: "error",
      payload: {
        message: error instanceof Error ? error.message : "Worker scan failed.",
      },
    });
  });

function postMessage(message) {
  parentPort?.postMessage(message);
}
