# NameMapping — General Best Practices

This document covers conventions and best practices for NameMapping in this project.

## Browser Alias Setup

Always create a top-level `browser` alias pointing to the browser process:

```
Aliases.browser → Sys.Process("chrome")
```

For cross-browser testing, use conditional mapping or separate suites per browser.

## Page Alias Naming Convention

Page aliases live directly under `Aliases.browser`:
- Use the pattern: `page<PageName>` (PascalCase after `page`)
- Map the page by **URL contains** condition (not full URL match)
- Examples:
  - `pageLogin` → URL contains `/login`
  - `pageDashboard` → URL contains `/dashboard`
  - `pageCheckout` → URL contains `/checkout`

## Element Alias Naming Convention

Element aliases live under their parent page alias:
- Use **camelCase**
- Name for what the element **is**, not where it is
- Good: `usernameField`, `loginButton`, `errorMessage`
- Bad: `input1`, `divTop`, `spanRed`

## Preferred Mapping Strategies (in priority order)

1. **id** — most stable: `id = "username"`
2. **data-testid** — purpose-built for testing: `data-testid = "username-input"`
3. **name** attribute — stable for inputs: `name = "username"`
4. **contentText** — for buttons: `contentText = "Sign In"`
5. **CSS class** — only if stable: `className contains "error-message"`
6. **XPath** — last resort; brittle and slow

## Handling Dynamic Content

For elements with dynamic ids (e.g. `id="input-32948"`):
- Use `name` or `placeholder` attribute instead
- Use `className` with a stable class name
- Use `data-testid` if you can add it to the application

## Using WaitProperty Before Interactions

Always wait for `Enabled = true` before clicking:
```javascript
element.WaitProperty('Enabled', true, TIMEOUT_SHORT);
element.Click();
```

Wait for `Exists = true` before reading text:
```javascript
element.WaitProperty('Exists', true, TIMEOUT_MEDIUM);
var text = element.contentText;
```

## Debugging Broken Mappings

1. **Object Browser** (F12) — navigate to the element in Object Browser and compare with your alias
2. **Highlight** button — in NameMapping, select the alias and click Highlight
3. **Log.Message** — add `Log.Message(element.Name)` to see what TC resolves
4. **Re-map** — if the alias can't resolve, delete and re-create from Object Browser

## Adding a New Page

1. Open the browser to the new page
2. In NameMapping, right-click `Aliases.browser` → Add Child Item
3. Name it `page<NewPage>` — map to the page by URL
4. Add element aliases for each interactive element
5. Create `Script/Pages/<NewPage>Page.js`
6. Use `//USEUNIT Script\Base\BaseHelper` in the new page script
7. Define `getPage()`, element getters, and action functions
