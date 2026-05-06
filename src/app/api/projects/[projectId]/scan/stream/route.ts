import { AtlasStore } from "@/lib/atlas/storage";
import type { ScanJob } from "@/lib/atlas/types";
import { runScanInWorker } from "@/indexer/worker-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

type ProjectRouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(_request: Request, ctx: ProjectRouteContext) {
  const { projectId } = await ctx.params;
  const store = new AtlasStore();
  const project = store.getProject(projectId);

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const job: ScanJob = {
    id: crypto.randomUUID(),
    projectId,
    status: "running",
    progress: 0,
    fileCount: 0,
    indexedCount: 0,
    issueCount: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  store.createScanJob(job);

  const stream = new ReadableStream({
    async start(controller) {
      send(controller, "job", job);

      try {
        const result = await runScanInWorker({ project, scanId: job.id }, (progress) => {
          const updated = {
            ...job,
            progress: progress.progress,
            fileCount: progress.fileCount,
            indexedCount: progress.indexedCount,
          };
          store.updateScanJob(updated);
          send(controller, "progress", progress);
        });

        store.saveScanResult(projectId, job.id, result);
        const completeJob: ScanJob = {
          ...job,
          status: "complete",
          progress: 1,
          fileCount: result.summary.fileCount,
          indexedCount: result.summary.fileCount,
          issueCount: result.summary.issueCount,
          finishedAt: new Date().toISOString(),
          error: null,
        };
        store.updateScanJob(completeJob);
        send(controller, "complete", { job: completeJob, summary: result.summary });
      } catch (error) {
        const failedJob: ScanJob = {
          ...job,
          status: "failed",
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Scan failed.",
        };
        store.updateScanJob(failedJob);
        send(controller, "error", { error: failedJob.error, job: failedJob });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });

  function send(controller: ReadableStreamDefaultController<Uint8Array>, event: string, payload: object) {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
  }
}
