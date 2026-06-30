import { OrganizationCard } from "../organization-card";

export default function OrganizationCardExample() {
  return (
    <div className="p-4 max-w-sm">
      <OrganizationCard
        name="Acme Corporation"
        projectCount={12}
        memberCount={45}
        status="active"
      />
    </div>
  );
}
