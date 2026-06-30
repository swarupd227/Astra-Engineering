## BRD Direct LLM Pass-Through - Changes Summary

**Date:** December 20, 2025

### Changes Made

#### 1. System Prompt (server/routes.ts - ~line 883)
**Status:** ✅ COMMENTED OUT

The restriction rule has been commented out:
```
/* COMMENTED OUT - Now passing full BRD document directly to LLM for artifact generation
When BRD is uploaded then all artifacts must be derived strictly from the summarized BRD, not the full document.
*/
```

**Reason:** Allow the full BRD document to be passed to the LLM without restricting to summarized content.

---

#### 2. Requirement Extraction Logic (server/routes.ts - ~line 2002)
**Status:** ✅ COMMENTED OUT

The entire requirement extraction block has been disabled:
```javascript
/* 
const parsedRequirements = parseRequirementsFromBrdJson(...);
// ... rest of extraction and DB insertion code ...
*/
```

**Replaced with:**
```javascript
console.log(
  "[Routes][DEV-BRD][Requirements] SKIPPED: Requirement extraction disabled.",
  "Full BRD document (rawMarkdown) will be passed directly to LLM for artifact generation.",
  "BRD ID:", brdId,
);
```

---

### What This Means

**Before:**
- BRD uploaded → Requirements extracted from "Requirements" section only
- Extracted requirements parsed into individual rows
- Stored in `devBrdRequirements` table
- LLM used these extracted requirements to generate artifacts
- ❌ **Limitation:** Only the "Requirements" section was considered

**After:**
- BRD uploaded → Full document remains intact
- `generatedJson.rawMarkdown` contains the complete BRD (all sections)
- **Full BRD content is passed directly to LLM**
- ✅ **Benefit:** LLM can see entire BRD context: Executive Summary, Business Objectives, Constraints, Timeline, Budget, Stakeholders, etc.

---

### How to Revert

If you need to re-enable requirement extraction:
1. Uncomment the requirement extraction logic in routes.ts (~line 2002)
2. Uncomment the system prompt rule (~line 891)
3. Re-enable: `parseRequirementsFromBrdJson()` and DB insertion

---

### Next Steps

**To pass full BRD to LLM for artifact generation:**
1. Ensure the workflow/artifact generation endpoints include the full `generatedBrdJson.rawMarkdown` in the context
2. Update the LLM prompts to reference the complete BRD document instead of individual requirements
3. Test artifact generation with the full BRD context

---
