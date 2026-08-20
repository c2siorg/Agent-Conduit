/**
 * A Project (Conduit extension) — a governance boundary that isolates credentials. Connections and agents
 * belong to a project; an agent may only use connections in its own project (or unassigned/global ones),
 * so a compromised or misdirected agent in one project cannot reach another project's credentials.
 * This layers UNDER the AAP identity + capability model; it does not change how agents authenticate.
 */
export interface Project {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}
