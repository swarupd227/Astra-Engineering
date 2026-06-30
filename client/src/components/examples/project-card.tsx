import { ProjectCard } from "../project-card";

export default function ProjectCardExample() {
  return (
    <div className="p-4 max-w-sm">
      <ProjectCard
        name="E-Commerce Platform"
        organization="Acme Corporation"
        repoCount={5}
        cloudProvider="GitHub"
        status="active"
      />
    </div>
  );
}
