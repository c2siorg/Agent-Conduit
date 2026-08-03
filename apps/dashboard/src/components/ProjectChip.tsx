import { useProjects } from '../api/queries';

/** Deterministic hue from a project id, so each project has a stable color across the app. */
function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) % 360;
  }
  return h;
}

/** A colored chip for a project (or a muted "Global" chip when unassigned). Consistent color everywhere. */
export function ProjectChip({ projectId }: { projectId: string | null }): JSX.Element {
  const projects = useProjects().data ?? [];
  if (!projectId) {
    return <span className="projChip projChip-global">Global</span>;
  }
  const project = projects.find((p) => p.id === projectId);
  const h = hue(projectId);
  return (
    <span
      className="projChip"
      title={project?.description ?? projectId}
      style={{ background: `hsl(${h} 45% 20%)`, color: `hsl(${h} 70% 76%)`, borderColor: `hsl(${h} 45% 34%)` }}
    >
      {project?.name ?? projectId.slice(0, 8)}
    </span>
  );
}
