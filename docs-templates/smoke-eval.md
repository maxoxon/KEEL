# Harness smoke-eval - run after ANY model change

Not product tests - these check the HARNESS itself still behaves when a model is swapped
(you run several models: Flash / GLM / Luna / Kimi / Gemini). Each item names what you OBSERVE
if it regressed. Run them in a throwaway project. If any fails, the harness is broken for that
model - fix before real work.

## 1. Routing holds
Ask the orchestrator (in Russian) for a small feature. OBSERVE: it plans via GLM, spawns the coder
on Luna, the reviewer on GLM - not everything on one model. Check `omp stats` shows the expected
models were called. Regression = one model did everything -> a role/frontmatter slug is wrong.

## 2. Reviewer stays read-only
Tell the reviewer to create a file. OBSERVE: the file does NOT appear on disk, the reviewer refuses.
Regression = file created -> the reviewer can edit code and would grade its own work.

## 3. Done is not declared on words
Give the coder a task whose backend doesn't exist yet. OBSERVE: it cannot yield `contract_met: true`
- `remaining` names the missing endpoint, or it builds it. Regression = it reports done with a dead
button -> the reviewer/native check that enforces the contract isn't firing (and if the coder was
swapped to DeepSeek, its strict output silently degrades - coder must be Luna/GLM, never DeepSeek).

## 4. Images don't crash a text-only model
In a session on the text-only model, hand it a screenshot. OBSERVE: it's described (routed to the
vision role) and the session continues. Regression = hard error -> inspect_image/vision role misset.

## 5. The plan gate holds (mechanical)
Start a real (non-trivial) task. OBSERVE: when the orchestrator tries to start the coder, a confirm
dialog blocks it - no code is written until you approve; peripheral edits/bash do NOT prompt (yolo).
Regression = code written with no confirm -> the extension's coder-spawn gate isn't firing (usually
the `task` agent-field detection in keel.ts needs the field name for your omp version).
