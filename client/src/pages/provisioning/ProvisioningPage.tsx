import { PageHeader } from "@/components/ui/page-header";
import { ProvisionInstanceForm } from "@/components/provisioning/ProvisionInstanceForm";
import { Server } from "lucide-react";

export default function ProvisioningPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={Server}
        title="Provision Infrastructure Instance"
        subtitle="Create and manage Azure App Service instances directly from DevX"
        color="blue"
      />

      <ProvisionInstanceForm />
    </div>
  );
}
