import { AtlasDashboard } from "@/components/atlas-dashboard";
import { buildGraphSlice } from "@/indexer/slices";
import { AtlasStore, createEmptySummary } from "@/lib/atlas/storage";

export default function Home() {
  const store = new AtlasStore();
  const projects = store.listProjects();
  const selectedProject = projects[0] ?? null;
  const initialSlice = selectedProject
    ? buildGraphSlice(
        "overview",
        null,
        store.getNodes(selectedProject.id),
        store.getEdges(selectedProject.id),
        store.getIssues(selectedProject.id),
        store.getLatestSummary(selectedProject.id) ?? createEmptySummary(selectedProject),
      )
    : null;

  return <AtlasDashboard initialProjects={projects} initialSlice={initialSlice} />;
}
