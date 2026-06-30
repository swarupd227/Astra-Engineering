---
name: ui-guide
description: DevX 2.0 UI design conventions and page layout patterns. Use when creating new pages, modifying existing page layouts, adding headers, fixing spacing, or building UI components.
user-invocable: true
---

# DevX 2.0 — UI Design Guide

Follow these conventions when creating or modifying any page in the application.

---

## 1. Page Layout (Standard)

**Reference:** `client/src/pages/projects.tsx`

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

---

## 2. Page Layout (Sticky Header)

**Reference:** `client/src/pages/sdlc.tsx`

For pages that need a sticky header with selectors below the title:

```tsx
<div className="min-h-screen bg-background relative">
  <div>
    <div className="border-b bg-card sticky top-0 z-50">
      <div className="p-6">
        <PageHeader icon={...} title="..." color="..." />
        {/* Selectors, badges, filters */}
      </div>
    </div>
    <div className="p-6">
      {/* Main scrollable content */}
    </div>
  </div>
</div>
```

---

## 3. Page Layout (Full-Height with Filter Bar)

**Reference:** `client/src/pages/test-generation.tsx`

```tsx
<div className="h-screen bg-background flex flex-col overflow-hidden">
  <div className="border-b border-border bg-card p-6 flex-shrink-0">
    <PageHeader icon={...} title="..." color="..." />
  </div>
  <div className="flex-1 overflow-auto p-6">
    {/* Content */}
  </div>
</div>
```

---

## 4. Page Layout (With Back Button)

**Reference:** `client/src/pages/test-cases-view.tsx`

```tsx
<div className="border-b border-border bg-card p-6 flex-shrink-0">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-4">
      <Button variant="ghost" size="sm" onClick={goBack}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
      <PageHeader icon={...} title="..." color="...">
        <Badge>{contextInfo}</Badge>
      </PageHeader>
    </div>
  </div>
</div>
```

---

## 5. PageHeader Component

**Location:** `client/src/components/ui/page-header.tsx`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `icon` | `LucideIcon` | Yes | Icon from lucide-react |
| `title` | `string` | Yes | Page title (renders as h1) |
| `subtitle` | `string` | No | Small description below title |
| `color` | `string` | No | `blue` `violet` `emerald` `amber` `rose` `slate` `orange` `cyan` |
| `children` | `ReactNode` | No | Buttons/badges rendered on the right |
| `data-testid` | `string` | No | Test ID for the h1 element |

**Renders:** Colored icon badge (h-10 w-10 rounded-xl) + title (text-xl font-semibold) + subtitle (text-xs text-muted-foreground)

---

## 6. Color Tokens (Dark Mode Support)

NEVER use hardcoded colors. Always use design system tokens:

| BAD (hardcoded) | GOOD (token) |
|---|---|
| `bg-white` | `bg-background` or `bg-card` |
| `text-gray-900` | `text-foreground` |
| `text-gray-500` | `text-muted-foreground` |
| `border-gray-200` | `border-border` |
| `bg-gray-50` / `bg-gray-100` | `bg-muted` |
| `hover:bg-gray-100` | `hover:bg-muted` |
| `style={{ backgroundColor: '...' }}` | Use Tailwind class |
| inline `boxShadow` | `shadow-sm` / `shadow-md` |

---

## 7. Card Styling

```
rounded-2xl shadow-sm border border-border/40 border-l-[3px] border-l-{color}-500
hover:shadow-md hover:-translate-y-0.5 transition-all duration-300
```

Icon badges inside cards: `h-9 w-9 rounded-xl bg-{color}-100 dark:bg-{color}-950`

---

## 8. Skeleton Loaders

Skeletons MUST mirror the actual content structure:
- Same container classes (padding, grid, gaps)
- Same card shapes (rounded-2xl, border-l accents)
- Same grid layout (col-span, row-span)

---

## 9. Button Conventions

| Use case | Pattern |
|---|---|
| Primary action | `<Button>` (default variant) |
| Secondary action | `<Button variant="outline">` |
| Back navigation | `<Button variant="ghost" size="sm">` |
| "View all" link | `<Button variant="ghost" size="sm" asChild><Link>View all <ArrowRight /></Link></Button>` |

---

## 10. Dropdown / Command Pattern

Use shadcn defaults — no inline color overrides:

```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Select...</Button>
  </PopoverTrigger>
  <PopoverContent className="p-0">
    <Command>
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup>
          <CommandItem>...</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
```

---

## 11. Dashboard Bento Grid

```tsx
<div className="bento-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:flex-1 lg:min-h-0">
  {/* Row 1: 4 KPI cards (1 col each) */}
  {/* Row 2-3, Col 1-2: Chart card (md:col-span-2 lg:row-span-2) */}
  {/* Row 2, Col 3-4: List card (md:col-span-2) */}
  {/* Row 3, Col 3-4: List card (md:col-span-2) */}
</div>
```

With CSS: `@media (min-width: 1024px) { .bento-grid { grid-template-rows: auto 1fr 1fr; } }`
