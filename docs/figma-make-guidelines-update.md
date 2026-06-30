# Figma Make Guidelines - Comprehensive Update

## Overview
Updated the `generateDesignGuidelines()` function in `ai-service.ts` to provide production-grade, comprehensive design guidelines optimized for Figma Make AI tool integration.

## Business Context
The backlog refinement AI agent asks questions to gather project requirements and generates:
1. **High-quality Agile artifacts** (Epics, Features, User Stories)
2. **Figma Make guidelines** - Copy-paste ready prompts for generating production-quality prototypes in Figma Make

## Key Improvements Made

### 1. Enhanced System Prompt
**Before:** Generic UI/UX expert focusing on basic design principles
**After:** Senior Design System Architect with specific Figma Make AI compatibility expertise

Key additions:
- Production-grade visual fidelity emphasis (not wireframes)
- Complete interaction patterns and micro-animations
- Enterprise design system patterns (Linear, GitHub, Atlassian, Microsoft Fluent)
- Developer-friendly specifications with exact measurements
- Real data patterns and content structure

### 2. Comprehensive Color System & Theming (Section 1)
**Enhancements:**
- Primary, secondary, and semantic color palettes with HEX, RGB, and HSL values
- Dark mode palette with specific overrides
- Hover, active, and disabled state color variations
- Color usage rules and WCAG contrast ratio guidelines
- Never use pure black rule (#000000)
- Opacity specifications for different states

**Example:**
```
Primary: #0066CC (rgb(0, 102, 204), hsl(210, 100%, 40%))
Usage: Primary buttons, main CTAs, active states
Hover: #0052A3 (darkened 15%)
Active: #003D7A (darkened 30%)
```

### 3. Detailed Typography System (Section 2)
**Enhancements:**
- Complete type scale from Display (60px) to Caption (12px)
- Font weights, line heights, letter spacing for each level
- Responsive typography rules (mobile adjustments)
- Specialized styles (button text, label text, code/monospace)
- Usage context for each typography level

**Example:**
```
H1: 36px / 2.25rem, font-weight: 700, line-height: 1.25
Usage: Main page headings (Dashboard title, Organization name)
Mobile: Reduce to 28px (22% reduction)
```

### 4. Professional Layout & Spacing System (Section 3)
**Enhancements:**
- Grid architecture for Desktop, Tablet, and Mobile
- 8pt spacing scale with component-specific spacing
- Z-index layer system for proper stacking
- Container widths and column grids
- Gutter and margin specifications

**Example:**
```
SPACING SCALE:
• 4px (0.25rem) - Micro spacing (icon-text gaps)
• 8px (0.5rem) - Tight spacing (button padding-x)
• 16px (1rem) - Base spacing (card padding)
• 32px (2rem) - Large spacing (component gaps)
```

### 5. Comprehensive Component Library (Section 4)
**Massive Expansion:**
- **Buttons:** Primary, Secondary, Ghost, Icon buttons with all states
- **Form Elements:** Text inputs, dropdowns, checkboxes, radio buttons, toggles, textareas
- **Cards:** Standard, metric cards with hover effects and variants
- **Navigation:** Top bar, sidebar, breadcrumbs, tabs with exact specifications
- **Data Display:** Tables, lists, badges with sorting and pagination
- **Modals & Overlays:** Modals, tooltips, toasts, dropdown menus
- **Feedback Components:** Loading spinners, skeleton screens, progress bars, empty states

**Each component includes:**
- Exact dimensions (height, width, padding)
- Border radius, shadows, colors
- All states (default, hover, active, focus, disabled, loading, error)
- Animation specifications
- Keyboard navigation patterns

**Example - Primary Button:**
```
Visual: Background #0066CC, Text white, Height 40px, Padding 12px 24px
States:
• Hover: Background #0052A3, shadow elevation, translate-y -1px
• Active: Background #003D7A, shadow remove, translate-y 0
• Focus: 2px outline #0066CC at 4px offset with ring effect
• Disabled: Background #D1D5DB, opacity 0.5, cursor not-allowed
• Loading: Spinner + "Processing..." text

Variants: Small (32px), Medium (40px), Large (48px)
```

### 6. Interaction Patterns & Animations (Section 5)
**New Section:**
- Motion tokens (duration, easing, delays)
- Component-specific interactions for buttons, forms, cards, modals
- Page transitions and tab switches
- Accessibility considerations (prefers-reduced-motion)

**Example:**
```
DURATION:
• Instant: 100ms (micro-interactions)
• Fast: 150ms (hover states)
• Normal: 250ms (modals, dropdowns)
• Slow: 400ms (complex animations)

Modal Animation:
• Entry: Backdrop fade 0→0.5 (200ms), Modal scale 0.95→1 (300ms ease-out)
• Exit: Modal fade out (200ms), Backdrop fade out (200ms delay)
```

### 7. Information Architecture & Page Layouts (Section 6)
**New Section:**
- Page archetypes with ASCII diagrams: Dashboard, List View, Detail View, Form View, Settings
- Navigation patterns (primary, secondary, contextual)
- Content hierarchy principles
- Scanning patterns (F-pattern, Z-pattern)
- White space usage guidelines

**Example - Dashboard Layout:**
```
┌─────────────────────────────────────┐
│  Page Header (64px)                 │
├─────────────────────────────────────┤
│  Metrics Row (4 cards, 1/4 width)   │
├─────────────────────────────────────┤
│  Charts Section (2-column)          │
├─────────────────────────────────────┤
│  Data Table (full width)            │
└─────────────────────────────────────┘
```

### 8. Accessibility & Inclusive Design (Section 7)
**Massive Expansion:**
- WCAG 2.1 AA compliance details with specific ratios
- Focus indicators with CSS examples
- Touch target specifications (44x44px minimum)
- Comprehensive keyboard navigation patterns
- Screen reader support (ARIA labels, roles, states, live regions)
- Text & typography readability rules
- Motion preferences (prefers-reduced-motion)
- Form accessibility best practices
- Color blindness considerations

**Example:**
```
FOCUS INDICATORS:
• Outline: 2-3px solid #0066CC
• Offset: 2-4px from element edge
• Ring effect: 3-4px shadow at 30% opacity

CSS Example:
button:focus-visible {
  outline: 2px solid #0066CC;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px rgba(0,102,204,0.3);
}
```

### 9. Iconography, Imagery & Visual Elements (Section 8)
**Significant Expansion:**
- Icon system specifications (sizes, styles, libraries)
- Common icons mapping
- Illustration style guide
- Empty state designs with structure
- Error state patterns (inline, full-page, toast)
- Avatar specifications with initials formula
- Logo and branding usage guidelines

**Example:**
```
ICON SIZES:
• 12px: Inline text icons
• 16px: Default UI icons
• 20px: Navigation icons
• 24px: Larger buttons
• 32px: Feature icons
• 48px: Hero sections

STYLE: Outlined (1.5-2px stroke), Filled (active states), Duotone (depth)
LIBRARY: Heroicons, Lucide, Phosphor Icons
```

### 10. Figma Make AI Prompt Templates (Section 9)
**Complete Overhaul:**
- Production-ready, copy-paste prompts for 5 key screens
- Each template includes detailed structure, content, colors, interactions
- Realistic content examples (not Lorem Ipsum)
- ASCII layout diagrams for clarity
- Responsive behavior specifications

**Templates Provided:**
1. **Dashboard View** - Admin dashboard with metrics, charts, tables
2. **List View with Filters** - Filterable list with cards, search, bulk actions
3. **Multi-Step Form** - Form wizard with progress indicator and validation
4. **Detail View with Sidebar** - Two-column detail page with metadata
5. **Settings Page** - Tab-based settings with various input types

**Example - Dashboard Prompt:**
```
Create a modern admin dashboard for [APPLICATION_NAME]:

LAYOUT:
• Top navigation: 64px height, search bar 400px, notification + avatar
• Sidebar: 256px width, #F9FAFB background
• Main content: 32px padding, max-width 1440px

CONTENT:
• Metrics row: 4 cards (equal width, gap 24px)
  - Icon: 40x40px, background #F0F7FF
  - Value: 36px bold, centered
  - Trend: Green ↑ +12% or red ↓ -5%
• Charts: Line chart (2/3) + Donut chart (1/3)
• Table: Sortable, striped rows, pagination

INTERACTIONS:
• Cards: Hover shadow + translate-y -2px
• All transitions: 200ms ease-out

Production-ready with exact spacing and real data.
```

### 11. Responsive Design Breakpoints (Section 10)
**New Section:**
- Breakpoint system (Mobile, Tablet, Desktop, Large Desktop)
- Mobile-first approach guidelines
- Layout adjustments for each breakpoint
- Component responsiveness patterns

### 12. Production Deployment Checklist (Section 11)
**New Section:**
- Visual quality checks
- Interaction completeness
- Accessibility verification
- Responsive testing
- Content quality
- Documentation requirements

### 13. Final Figma Make AI Instructions (Section 12)
**New Section:**
- Best practices for using guidelines in Figma Make
- 6-point checklist for prompt creation
- Example final prompt template
- Customization reminders

## Alignment with Business Requirements

### ✅ Production-Grade Standards
- Enterprise design system patterns (Linear, GitHub, Atlassian, Fluent, Lightning)
- Exact specifications (px, rem, HEX, RGB, HSL values)
- All component states defined
- Professional polish and micro-interactions

### ✅ Figma Make Tool Compatibility
- Copy-paste ready prompts
- Precise, descriptive language Figma Make can interpret
- Realistic content examples
- Visual hierarchy and spatial relationships clearly defined
- Animation timing and triggers specified

### ✅ Developer-Friendly
- Exact measurements in px/rem and Tailwind classes
- CSS examples for complex patterns
- Component specifications ready for implementation
- Clear documentation structure

### ✅ Comprehensive Coverage
- 12 major sections covering all aspects of design
- 5 production-ready screen templates
- 20+ component specifications
- Accessibility and responsive design fully addressed

## Token Efficiency
- Increased `max_tokens` from 3000 to 4000 (considers expanded guidelines)
- Maintained temperature at 0.65 for balanced creativity and consistency
- Structured format ensures token usage is focused on valuable content

## Quality Assurance
- ✅ All TypeScript compile errors resolved
- ✅ Proper string escaping for template literals
- ✅ Consistent formatting and structure
- ✅ No duplicate sections
- ✅ Aligned with existing `design_guidelines.md`

## Expected Outcomes
When users receive Figma Make guidelines from the AI agent, they will:
1. **Copy-paste directly into Figma Make** without modifications
2. **Generate production-quality prototypes** that closely resemble final applications
3. **Maintain design consistency** across all screens and components
4. **Meet accessibility standards** (WCAG 2.1 AA)
5. **Save significant time** with pre-defined specifications and templates

## Next Steps
1. Test guidelines with actual Figma Make AI tool
2. Gather feedback from designers and developers
3. Iterate based on real-world usage patterns
4. Consider adding more screen templates based on common use cases
5. Update guidelines as Figma Make capabilities evolve

---

**Updated:** January 2025
**File:** `server/ai-service.ts` - `generateDesignGuidelines()` function
**Status:** ✅ Complete and Production-Ready
