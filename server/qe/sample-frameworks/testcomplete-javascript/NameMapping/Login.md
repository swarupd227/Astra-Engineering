# NameMapping Setup — Login Page

Follow these steps to configure the TestComplete NameMapping aliases
required by `Script/Pages/LoginPage.js`.

## Required Alias Tree
```
Aliases
  └── browser                    ← The browser process
        └── pageLogin            ← The Login page
              ├── usernameField  ← Username / email input
              ├── passwordField  ← Password input
              ├── loginButton    ← Submit / Sign In button
              └── errorMessage   ← Error message container
```

## Step-by-Step Setup

### 1. Open the NameMapping Editor
**TestComplete** → **Tools** → **NameMapping** (or press F10)

### 2. Map the Browser Alias
- In the **NameMapping** panel, locate or create `Aliases`
- Right-click `Aliases` → **Add Child Item**
- Name it exactly: `browser`
- Set **Mapped Object** to your browser process (e.g. `Sys.Process("chrome")`)

### 3. Map the Login Page Alias
- Right-click `browser` → **Add Child Item**
- Name it exactly: `pageLogin`
- In the **Object Browser**, navigate to your login page
- Set the page mapping condition: **URL contains** `/login`

### 4. Map the Username Field
Under `pageLogin`, right-click → **Add Child Item**:
- **Alias Name:** `usernameField`
- **Mapping:** Find by `id = "username"` OR `name = "username"`
- **Verify:** Object Browser should highlight the username input

### 5. Map the Password Field
Under `pageLogin`, right-click → **Add Child Item**:
- **Alias Name:** `passwordField`
- **Mapping:** Find by `id = "password"` OR `type = "password"`
- **Verify:** Object Browser should highlight the password input

### 6. Map the Login Button
Under `pageLogin`, right-click → **Add Child Item**:
- **Alias Name:** `loginButton`
- **Mapping:** Find by `type = "submit"` OR `contentText contains "Sign In"`
- **Verify:** Clicking it in Object Browser highlights the submit button

### 7. Map the Error Message
Under `pageLogin`, right-click → **Add Child Item**:
- **Alias Name:** `errorMessage`
- **Mapping:** Find by `className contains "error-message"` OR `id = "error-message"`
- **Note:** This element only appears after a failed login attempt.
  Map it when the element is visible in the browser.

## Verification

After mapping all elements:
1. Open the browser to your login page
2. In **NameMapping** panel, select each alias
3. Click the **Highlight** button — the element should flash in the browser
4. If no highlight: check the selector condition and re-map

## Troubleshooting

| Problem | Solution |
|---|---|
| Element not found at runtime | Check if the page URL matches the `pageLogin` condition |
| `Aliases.browser.pageLogin is undefined` | Verify the browser alias is set to the correct process |
| Element found but wrong element | Make the selector more specific (add id or data-testid) |
| Works in dev, breaks in staging | Check if element ids change between environments |
