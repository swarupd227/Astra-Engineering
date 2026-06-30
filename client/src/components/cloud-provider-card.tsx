import { Card, CardContent } from "@/components/ui/card";
import { Cloud, Check } from "lucide-react";
import { SiGithub, SiGitlab, SiAmazon } from "react-icons/si";

interface CloudProviderCardProps {
  provider: "github" | "gitlab" | "azure" | "aws";
  isSelected?: boolean;
  onSelect?: () => void;
}

const providerConfig = {
  github: {
    name: "GitHub",
    icon: SiGithub,
    color: "text-gray-900 dark:text-white",
  },
  gitlab: {
    name: "GitLab",
    icon: SiGitlab,
    color: "text-orange-600",
  },
  azure: {
    name: "Azure DevOps",
    icon: Cloud,
    color: "text-blue-600",
  },
  aws: {
    name: "AWS CodeCommit",
    icon: SiAmazon,
    color: "text-orange-500",
  },
};

export function CloudProviderCard({ provider, isSelected = false, onSelect }: CloudProviderCardProps) {
  const config = providerConfig[provider];
  const Icon = config.icon;

  return (
    <Card
      className={`cursor-pointer hover-elevate active-elevate-2 border-l-[3px] border-l-cyan-500 ${
        isSelected ? "ring-2 ring-primary" : ""
      }`}
      onClick={() => {

        onSelect?.();
      }}
      data-testid={`card-provider-${provider}`}
    >
      <CardContent className="flex flex-col items-center justify-center p-6 relative">
        {isSelected && (
          <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-4 w-4" />
          </div>
        )}
        <Icon className={`h-12 w-12 ${config.color}`} />
        <p className="mt-3 text-sm font-medium text-center">{config.name}</p>
      </CardContent>
    </Card>
  );
}
