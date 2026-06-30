import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  /** Label shown next to the arrow. Defaults to "Back" */
  label?: string;
  /** Click handler. If omitted, navigates to `href` via wouter. */
  onClick?: () => void;
  /** Path to navigate to when clicked (used when onClick is not provided). */
  href?: string;
  /** Query params to append to href. */
  params?: Record<string, string>;
  className?: string;
}

export function BackButton({
  label = "Back",
  onClick,
  href,
  params,
  className,
}: BackButtonProps) {
  const [, setLocation] = useLocation();

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    if (href) {
      const search = params
        ? `?${new URLSearchParams(params).toString()}`
        : "";
      setLocation(`${href}${search}`);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      className={cn("shrink-0 gap-1.5", className)}
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}
