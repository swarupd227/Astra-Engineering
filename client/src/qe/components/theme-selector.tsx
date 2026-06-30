import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Palette } from "lucide-react";
import { useTheme, colorSchemes } from "@/contexts/ThemeContext";

export function ThemeSelector() {
  const { currentTheme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="button-theme-selector">
          <Palette className="w-5 h-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" data-testid="menu-theme-dropdown">
        {colorSchemes.map((scheme) => (
          <DropdownMenuItem
            key={scheme.id}
            onClick={() => setTheme(scheme.id)}
            className="flex items-center gap-3 cursor-pointer"
            data-testid={`menu-item-theme-${scheme.id}`}
          >
            <div className="flex items-center gap-2 flex-1">
              <div
                className="w-4 h-4 rounded-full border border-slate-600"
                style={{ backgroundColor: scheme.accent }}
                data-testid={`swatch-${scheme.id}`}
              />
              <span>{scheme.name}</span>
            </div>
            {currentTheme.id === scheme.id && (
              <span className="text-xs text-muted-foreground">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
