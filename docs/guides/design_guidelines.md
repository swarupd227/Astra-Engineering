# Design Guidelines: Multi-Tenant Development Platform

## Design Approach

**Selected Approach:** Design System - Enterprise Developer Tools Pattern

Drawing inspiration from Linear, GitHub, and GitLab's enterprise interfaces, optimized for information-dense developer workflows with multi-tenant complexity.

**Key Principles:**
- Clarity over decoration - information hierarchy drives every decision
- Consistent patterns across tenant boundaries
- Purposeful use of space for complex data structures
- Enterprise-grade reliability in visual language

## Core Design Elements

### Typography

**Font Family:** Inter (primary), JetBrains Mono (code/technical)

**Hierarchy:**
- Hero/Page Titles: text-3xl to text-4xl, font-semibold (Super admin dashboards, organization names)
- Section Headers: text-xl to text-2xl, font-semibold (Project titles, card headers)
- Component Labels: text-sm, font-medium (Form labels, sidebar items, metric labels)
- Body Text: text-sm to text-base, font-normal (Descriptions, table content)
- Metadata/Captions: text-xs, font-normal (Timestamps, counts, status indicators)
- Code/Technical: text-sm, font-mono (Repository URLs, technical identifiers)

### Layout System

**Spacing Primitives:** Tailwind units of 2, 4, 6, and 8 for consistency
- Component padding: p-4 to p-6
- Card spacing: p-6 to p-8
- Section gaps: gap-6 to gap-8
- Page margins: px-6 to px-8
- Vertical rhythm: space-y-4 to space-y-6

**Grid Structure:**
- Dashboard layouts: 12-column grid with responsive breakpoints
- Sidebar: Fixed width 64 (w-64) for navigation hierarchy
- Main content: Flexible with max-w-7xl container
- Card grids: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 for metrics/repositories

### Component Library

**Navigation Components:**
- **Top Bar:** Full-width header with organization/project context switcher, search, notifications, user menu
- **Sidebar Navigation:** Multi-level hierarchy (Super Admin > Organizations > Projects) with collapsible sections, active state indicators, icon + label pattern
- **Breadcrumbs:** Always visible for deep navigation contexts showing current path
- **Context Switcher:** Dropdown for organization/project selection with search capability

**Dashboard Widgets:**
- **Metric Cards:** 3-4 column grid showing key statistics (Total Organizations, Active Projects, Repository Count, Active Users) with icon, number (text-3xl font-bold), and label
- **Activity Feed:** Timeline-style list of recent actions with user avatars, timestamps, action descriptions
- **Quick Actions Panel:** Prominent CTAs for primary workflows (Create Organization, New Project, Browse Golden Repos)
- **Repository Cards:** Visual cards showing repo name, description, technology tags, selection checkbox, preview capability

**Forms & Inputs:**
- Text inputs: h-10 with border, rounded-md, focus states with ring
- Select dropdowns: Consistent styling with chevron indicator
- Multi-select tags: Pill-style chips with remove capability
- Checkbox/Radio: Custom styled for brand consistency
- Form sections: Grouped with dividers, clear labels, helper text below inputs

**Data Display:**
- **Tables:** Stripe pattern (alternate row shading), sortable headers, action columns, pagination
- **Status Badges:** Rounded pills with semantic variations (Active, Pending, Archived, Error)
- **Tag Clouds:** Technology stack badges, category filters, selectable chips
- **Progress Indicators:** Linear progress bars for repository initialization, multi-step wizards

**Modals & Overlays:**
- **Confirmation Dialogs:** Center modal for critical actions (Delete organization, Confirm repository copy)
- **Full-screen Wizards:** Multi-step flows for complex processes (Cloud DevOps integration setup)
- **Slide-over Panels:** Right-side drawers for quick edits, details view, notifications panel
- **Dropdown Menus:** Consistent styling for context menus, user menus, action menus

**Cloud Provider Integration UI:**
- **Provider Selection:** Large clickable cards with provider logos (Azure, AWS, GitHub, GitLab)
- **Credential Forms:** Dynamic form fields based on selected provider with secure input indicators
- **Repository Naming:** Real-time validation, naming convention helpers, availability checks
- **Connection Status:** Visual feedback for authentication state, connection testing results

**Golden Repository Catalog:**
- **Repository Cards:** Grid layout with thumbnail/icon, title, description (truncated), tech stack badges, star count, selection state
- **Filter Sidebar:** Category filters, technology filters, search by name/description
- **Selected Items Panel:** Persistent view of selected repositories with count badge, bulk actions
- **Preview Modal:** Full repository details, README preview, file structure tree, selection confirmation

**Conversational UI Component:**
- **Chat Interface:** Fixed bottom-right bubble launcher, expandable chat panel
- **Message Bubbles:** User messages (right-aligned), system responses (left-aligned), timestamps
- **Quick Actions:** Suggested actions as interactive chips, command palette integration
- **Context Awareness:** Show current project/organization context within chat

### Theme Architecture

**Dark Theme Foundation:**
- Deep backgrounds for reduced eye strain during extended use
- Elevated surfaces with subtle gradients for depth
- High contrast text for readability
- Subdued accent colors that don't overwhelm

**Light Theme Foundation:**
- Clean white/off-white backgrounds
- Subtle shadows for component elevation
- Crisp text with sufficient contrast
- Vibrant but professional accent colors

**Consistent Patterns Across Themes:**
- Same spacing, typography hierarchy, component structure
- Border weights and radii remain identical
- Hover/focus states maintain same interaction patterns
- Icons maintain same visual weight

### Responsive Behavior

**Desktop (lg and above):** Full feature set, multi-column dashboards, persistent sidebar
**Tablet (md):** Collapsible sidebar, 2-column grids, touch-optimized targets
**Mobile (base):** Hamburger menu, single column, stacked cards, bottom navigation for primary actions

### Images

**Hero Section:** Not applicable - enterprise dashboards lead with functional content, not marketing imagery

**Contextual Imagery:**
- Provider Logos: Azure, AWS, GitHub, GitLab logos in provider selection cards (200x80px, SVG preferred)
- Technology Icons: Stack-specific icons for repository tags (32x32px)
- Empty States: Illustrations for "No organizations yet", "No repositories selected" (300x200px, subtle, friendly)
- Avatar Placeholders: User/organization avatars with initials fallback (40x40px circular)

### Accessibility Standards

- Maintain WCAG AA contrast ratios in both themes
- Keyboard navigation for all interactive elements
- Focus indicators visible on all focusable elements
- ARIA labels for icon-only buttons
- Screen reader announcements for dynamic content updates
- Form validation with clear error messages

### Animation Strategy

**Minimal, Purposeful Motion:**
- Sidebar collapse/expand: 200ms ease-in-out
- Modal/panel transitions: 300ms ease-out
- Notification toast slide-in: 250ms ease-in-out
- Loading states: Subtle pulse animation on skeletons
- **No scroll-triggered animations, no parallax, no decorative motion**