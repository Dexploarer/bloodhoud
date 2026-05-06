import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { ScanProgress, ScanResult } from "@/lib/atlas/types";
import type { ScanProjectInput } from "@/indexer/project-scan";
import { scanProject } from "@/indexer/project-scan";
import { Logger } from "@/lib/logger";

type WorkerMessage =
  | { type: "progress"; payload: ScanProgress }
  | { type: "complete"; payload: ScanResult }
  | { type: "error"; payload: { message: string } };

export async function runScanInWorker(
  input: ScanProjectInput,
  onProgress: (progress: ScanProgress) => void,
): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker: Worker;

    try {
      worker = new Worker(join(process.cwd(), "src/indexer/scan-worker.mjs"), {
        workerData: { input },
        execArgv: ["--import", "tsx"],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Worker could not start.";
      Logger.warn("WorkerRunner", "Falling back to in-process scan after worker start failed.", {
        message,
      });
      scanProject(input, onProgress).then(resolve).catch(reject);
      return;
    }

    worker.on("message", (message: WorkerMessage) => {
      if (settled) {
        return;
      }

      if (message.type === "progress") {
        onProgress(message.payload);
        return;
      }

      if (message.type === "complete") {
        settled = true;
        resolve(message.payload);
        return;
      }

      settled = true;
      reject(new Error(message.payload.message));
    });

    worker.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      Logger.warn("WorkerRunner", "Falling back to in-process scan after worker error.", {
        message: error.message,
      });

      scanProject(input, onProgress).then(resolve).catch(reject);
    });

    worker.on("exit", (code) => {
      if (code !== 0 && !settled) {
        settled = true;
        Logger.warn("WorkerRunner", "Worker exited before completing scan.", { code });
        scanProject(input, onProgress).then(resolve).catch(reject);
      }
    });
  });
}
