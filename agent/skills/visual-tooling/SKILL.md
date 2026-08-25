---
name: visual-tooling
description: How to verify UI claims - drive the browser through the accessibility tree first, fall back to vision only for genuinely visual questions, and treat tool output (not source code) as the only primary evidence. Injected by KEEL when the contract has frontend fields.
---

# Visual Tooling Policy

Two kinds of browser tooling exist. Use them in this order - never skip step 1.

## Step 1 - Default: the accessibility tree (text-based, no vision)

Use browser navigate / snapshot / click / type / fill-form for:
- Navigating pages, clicking buttons, filling forms
- Checking whether an element exists, is enabled/disabled, its label/text
- Reading error messages, confirming data appeared or disappeared
- Any question answerable from the accessibility tree - which is almost all functional QA

This is the default for every UI interaction. Do not reach for vision first.

## Step 2 - Vision fallback: only when genuinely visual

Use image analysis ONLY when the question cannot be answered from the accessibility
tree - i.e. it is about actual rendering:
- "Does the layout look broken or overlapping?"
- "Is this chart / image / icon rendering correctly?"
- "Are colours or spacing visually wrong?"
- Canvas content, custom-drawn UI, anything with no meaningful DOM representation

If unsure, take a snapshot first. If the accessibility tree already answers the
question, vision is not needed.

**Rule of thumb:** vision is the exception, not the default.

---

## QA verification procedure (mandatory)

This applies to ANY task that verifies rendered page state - live QA sweeps, bug-fix
verification, regression checks, acceptance testing. It is not optional and not
limited to "audit" work.

For each page or item, execute these steps **in order**. Do not start the next item
until step 7 is complete.

1. **Navigate** to the page's exact URL. Do not verify from source code, an API
   response, or memory. Load the page in a real browser.

2. **Check for a compile/error overlay.** If present, the page has a build error.
   Mark FAIL, record the overlay text, stop. Do not verify functionality on a broken page.

3. **Check console errors.** Record the count and content. A page with console errors
   is not a PASS.

4. **Take a snapshot** of the accessibility tree. This is the raw observation from
   which every claim must be derived.

5. **Verify the claim from the snapshot** - not from source, not from an API response.
   If the snapshot does not contain the claimed state, the claim is unverified.

6. **Record actual tool output as evidence:** excerpts from the snapshot showing the
   rendered state, the console output, or the evaluate result. Source-code analysis
   ("the file on disk has...") is NOT sufficient as primary evidence. It may
   supplement a browser observation; it may never substitute for one.

7. **Do not proceed until step 6 is written.**

### Verification Method column

Every QA report table must carry a "Verification Method" column:

| Value | Meaning |
|---|---|
| `Browser` | Real navigation + snapshot was taken and cited |
| `API` | API response inspection only (no page loaded) |
| `Code` | Source-code analysis only (no page, no API call) |
| `Mixed` | Combination, with at least one being Browser or API |

### Evidence quality rule

**False claims are prevented not by being careful, but by making the evidence visible.**
A claim citing actual tool output is self-verifying - the reader can see the snapshot
text. A claim citing source code is a code review, not a browser verification.

- Primary evidence: browser tool output (snapshot, console, evaluate)
- Supplementary evidence: source code, API responses
- A PASS verdict requires primary evidence. Source-code-only evidence is a FAIL by
  default: the item was not actually verified in a browser.
