import type { Project } from "./contracts";

export type ProjectGroup = { id: string; label: string | null; projects: Project[] };

// Mirrors the concise-web project switcher from be-concise 0.11.0.
export function projectLabel({ name, repo, missing }: Project): string {
  const base = !repo ? name : repo.worktree ? `${repo.worktree} (worktree)` : repo.name;
  return `${[base, repo?.subdir].filter(Boolean).join(" · ")}${missing ? " (missing)" : ""}`;
}

/** Groups projects by repository in list order. Hubs older than 0.11.0 send no repo, so they get one unlabeled group. */
export function projectGroups(projects: Project[]): ProjectGroup[] {
  const known = projects.some((project) => project.repo !== undefined);
  const groups = new Map<string, ProjectGroup>();
  for (const project of projects) {
    const id = project.repo?.root ?? "";
    if (!groups.has(id)) groups.set(id, { id, label: known ? project.repo?.name ?? "No git repository" : null, projects: [] });
    groups.get(id)!.projects.push(project);
  }
  return [...groups.values()];
}

export function visibleProjects(projects: Project[], showMissing: boolean, selected: string): Project[] {
  return projects.filter((project) => showMissing || !project.missing || project.cwd === selected);
}
