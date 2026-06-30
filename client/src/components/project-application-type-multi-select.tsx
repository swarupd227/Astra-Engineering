import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PROJECT_APPLICATION_TYPE_OPTIONS,
  formatProjectApplicationTypesLabel,
  normalizeProjectApplicationTypes,
  type ProjectApplicationType,
} from "@/lib/project-application-types";

interface ProjectApplicationTypeMultiSelectProps {
  value: ProjectApplicationType[];
  onChange: (value: ProjectApplicationType[]) => void;
  disabled?: boolean;
  className?: string;
  labelPrefix?: string;
}

export function ProjectApplicationTypeMultiSelect({
  value,
  onChange,
  disabled = false,
  className,
  labelPrefix,
}: ProjectApplicationTypeMultiSelectProps) {
  const normalizedValue = normalizeProjectApplicationTypes(value);
  const label = formatProjectApplicationTypesLabel(normalizedValue);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={className}
          disabled={disabled}
        >
          <span className="truncate">
            {labelPrefix ? `${labelPrefix}: ${label}` : label}
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {PROJECT_APPLICATION_TYPE_OPTIONS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={normalizedValue.includes(option.value)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => {
              onChange(
                normalizeProjectApplicationTypes(
                  checked
                    ? [...normalizedValue, option.value]
                    : normalizedValue.filter((type) => type !== option.value),
                ),
              );
            }}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start px-2 text-xs font-normal"
          onClick={() => onChange([])}
        >
          Clear selection
        </Button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
