# UI/UX Flow Guide - User Story Save & Push to Azure DevOps

## 1. User Stories List View

```
┌─────────────────────────────────────────────────────────────────┐
│ Requirement & Analysis → User Stories                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ User Story Card 1                              ┌──┐  │       │
│  │ Title: "As a user, I can..."             Status: To Do │     │
│  │ Description: "Implementation details..."     High Priority│   │
│  │                               │ View │ Edit │          │       │
│  │ Assignee: John • 5 pts                          │ (Opens Edit Dialog)
│  └──────────────────────────────────────────────────────┘       │
│                                                                    │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ User Story Card 2                                     │       │
│  │ [Similar layout]                                      │       │
│  │                               │ View │ Edit │         │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                    │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Edit User Story Dialog

```
┌──────────────────────────────────────────────────────────────────┐
│ ✕ Edit User Story                                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Title *                                                          │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ As a user, I can view my profile                           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Description                                           [✨ AI Help]│
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ This feature allows users to see their personal profile    │  │
│  │ information including name, email, and preferences.        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Status *                    Priority                             │
│  ┌──────────────────┐      ┌──────────────────┐                 │
│  │ To Do          ▼ │      │ Medium         ▼ │                 │
│  └──────────────────┘      └──────────────────┘                 │
│                                                                    │
│  Assigned To            Story Points                              │
│  ┌──────────────────┐      ┌──────────────────┐                 │
│  │ John Doe         │      │ 5              │                 │
│  └──────────────────┘      └──────────────────┘                 │
│                                                                    │
├──────────────────────────────────────────────────────────────────┤
│  [ Cancel ]  [ Push to Azure DevOps ]  [ Save Changes ]          │
│                     ↓ (New Button)           (Existing)
└──────────────────────────────────────────────────────────────────┘
```

## 3. Push to Azure DevOps Modal

```
┌──────────────────────────────────────────────────────────────────┐
│ ✕ Push User Story to Azure DevOps                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌ User Story Details ─────────────────────────────────────────┐ │
│  │ Title: As a user, I can view my profile                    │ │
│  │ Description: This feature allows users to see...           │ │
│  │ [To Do] [Medium Priority] [5 pts]                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌ Azure DevOps Configuration ▲ ─────────────────────────────┐  │
│  │ Organization *                                              │  │
│  │ ┌──────────────────────────────────────────────────────┐  │  │
│  │ │ your-org                                             │  │  │
│  │ └──────────────────────────────────────────────────────┘  │  │
│  │                                                              │  │
│  │ Project *                    Repository                    │  │
│  │ ┌──────────────────────┐  ┌──────────────────────┐        │  │
│  │ │ your-project       │  │ your-repo            │        │  │
│  │ └──────────────────────┘  └──────────────────────┘        │  │
│  │                                                              │  │
│  │ Branch                      Personal Access Token (PAT) *  │  │
│  │ ┌──────────────────────┐  ┌──────────────────────┐        │  │
│  │ │ main               │  │ ••••••••••••••••••  │        │  │
│  │ └──────────────────────┘  └──────────────────────┘        │  │
│  │ (Help text: Required to authenticate with Azure DevOps)  │  │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
├──────────────────────────────────────────────────────────────────┤
│  [ Cancel ]                    [ Push to Azure DevOps ]          │
│                                  (Enabled only with PAT)
└──────────────────────────────────────────────────────────────────┘
```

## 4. After Successful Push

```
┌──────────────────────────────────────────────────────────────────┐
│ ✕ Push User Story to Azure DevOps                                │
├──────────────────────────────────────────────────────────────────┤
│                                                                    │
│  [User Story Details shown as before]                             │
│                                                                    │
│  [Configuration sections...]                                      │
│                                                                    │
├──────────────────────────────────────────────────────────────────┤
│  [ Cancel ]        [ ✓ Pushed Successfully ]                     │
│                         (Button shows success state for 1.5s)
│                         (Dialog auto-closes after)
│
│  Toast Notification (top-right):
│  ✓ User story pushed to Azure DevOps successfully!
└──────────────────────────────────────────────────────────────────┘
```

## 5. Edit Dialog with Both Options

```
DialogFooter Layout:

[ Cancel ]  [ Push to Azure DevOps ]  [ Save Changes ]
            ↑ (NEW - Only for stories)   ↑ (EXISTING)

Both buttons available simultaneously:
- Save Changes: Updates local database
- Push to Azure DevOps: Creates/updates work item in Azure DevOps
```

## 6. Data Flow Diagram

```
┌─────────────┐
│ User Stories│
│   List View │
└──────┬──────┘
       │ (Click Edit)
       ↓
┌──────────────────────┐
│ WorkItemEditDialog   │
│ (Load user story)    │
└──────┬──────────────┬┘
       │              │
       │ Save Changes │ Push to Azure DevOps (NEW)
       │              │
       ↓              ↓
   Database    ┌─────────────────┐
               │ Push Modal      │
               │ (Configure ADO) │
               └────────┬────────┘
                        │ (Enter PAT & Click Push)
                        ↓
                   Backend API
                  /api/workflow/
                push-devops-single-story
                        │
                        ↓
                  Azure DevOps
                 (Create Work Item)
                        │
                        ↓
                   Success Message
```

## Key Points

1. **Save Button** (Existing)
   - Location: Edit Dialog Footer
   - Action: Saves to local database
   - Feedback: "Item updated successfully"

2. **Push to Azure DevOps Button** (New)
   - Location: Edit Dialog Footer (between Cancel and Save)
   - Visibility: Only for User Stories and Backlog items
   - Action: Opens modal to configure ADO
   - Feedback: Success/Error toast notification

3. **Configuration Pre-population**
   - Organization and Project are auto-filled from selected ADO project
   - Users only need to provide PAT
   - Other fields (Repository, Branch) are optional

4. **User Experience**
   - Users can save locally first, then push to ADO
   - Or vice versa - push then make additional changes
   - No blocking - both operations are independent
