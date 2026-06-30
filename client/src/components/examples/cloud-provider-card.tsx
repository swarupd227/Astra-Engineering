import { CloudProviderCard } from "../cloud-provider-card";

export default function CloudProviderCardExample() {
  return (
    <div className="p-4 grid grid-cols-2 gap-4 max-w-md">
      <CloudProviderCard provider="github" isSelected={true} />
      <CloudProviderCard provider="gitlab" />
    </div>
  );
}
