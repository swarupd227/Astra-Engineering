# /ui-guide — DevX 2.0 UI Design Conventions

> Reference this when creating new pages, modifying layouts, adding headers, or building UI components.

## 1. Page Layout (Standard)

```tsx
import { PageHeader } from "@/components/ui/page-header";
import { IconName } from "lucide-react";

export default function MyPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <PageHeader
        icon={IconName}
        title="Page Title"
        subtitle="Brief description of this page"
        color="violet"
      >
        {/* Optional: action buttons on the right */}
        <Button>Action</Button>
      </PageHeader>

      {/* Page content */}
    </div>
  );
}
```

**Rules:**
- Container: `flex-1 space-y-6 p-6` (24px padding, 24px vertical gap)
- NEVER use `container`, `max-w-*`, or `mx-auto` on the page wrapper
- NEVER use `px-6 py-4` — always `p-6`

## 2. PageHeader Component

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `icon` | `LucideIcon` | Yes | Icon from lucide-react |
| `title` | `string` | Yes | Page title (renders as h1) |
| `subtitle` | `string` | No | Small description below title |
| `color` | `string` | No | `blue` `violet` `emerald` `amber` `rose` `slate` `orange` `cyan` |
| `children` | `ReactNode` | No | Buttons/badges rendered on the right |

## 3. Color Tokens (Dark Mode)

NEVER use hardcoded colors. Always use design system tokens:

| BAD (hardcoded) | GOOD (token) |
|---|---|
| `bg-white` | `bg-background` or `bg-card` |
| `text-gray-900` | `text-foreground` |
| `text-gray-500` | `text-muted-foreground` |
| `border-gray-200` | `border-border` |
| `bg-gray-50` / `bg-gray-100` | `bg-muted` |
| `hover:bg-gray-100` | `hover:bg-muted` |

## 4. Card Styling

```
rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-{color}-500
hover:shadow-md hover:-translate-y-0.5 transition-all duration-300
```

## 5. Skeleton Loaders

Skeletons MUST mirror the actual content structure:
- Same container classes (padding, grid, gaps)
- Same card shapes (rounded-2xl, border-l accents)
- Same grid layout (col-span, row-span)

## 6. Button Conventions

| Use case | Pattern |
|---|---|
| Primary action | `<Button>` (default variant) |
| Secondary action | `<Button variant="outline">` |
| Back navigation | `<Button variant="ghost" size="sm">` |

## 7. Module Structure (for complex features)

Any feature over ~400 lines must be split into a module:

```
client/src/components/{feature}/
├── types.ts       # All TypeScript interfaces
├── utils.ts       # Pure functions, no React
├── use-*.ts       # One hook per logical concern
├── *-panel.tsx    # Sub-components (>50 lines)
├── *-dialog.tsx   # Dialogs as standalone components
└── index.tsx      # Orchestrator only (~300–500 lines)
```

- **600-line cap** per file — split at that point
- **index.tsx** manages state and layout only — no inline render helpers
