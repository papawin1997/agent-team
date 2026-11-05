---
name: tb-writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the tb-writing-plans skill to create the implementation plan."

**Language — เขียน plan เป็นภาษาไทย:** เนื้อหา plan ทั้งหมดที่เป็นภาษาธรรมชาติ (Goal,
Architecture, คำอธิบาย task/step, ชื่อ task, ข้อความบอกขั้นตอน, Global Constraints ฯลฯ)
**ต้องเขียนเป็นภาษาไทย** ส่วนที่ต้องคงเป็นภาษาอังกฤษคือ: โค้ด, ชื่อไฟล์/พาธ, คำสั่ง terminal,
ชื่อฟังก์ชัน/ตัวแปร/type, และ technical term ที่แปลแล้วจะกำกวม (เก็บคำอังกฤษไว้ในวงเล็บได้)
ตั้ง `<html lang="th">` ในทุก plan

**Context:** If working in an isolated worktree, it should have been created via the `tb-using-git-worktrees` skill at execution time.

**Save plans to:** `docs/plan/YYYY-MM-DD-<feature-name>.html`
- Use the workspace root path already available from context — do NOT run `git rev-parse` or any terminal command to resolve the path
- The plan is a self-contained HTML file with framed, colored sections (see templates below)
- (User preferences for plan location override this default)

## Scope Check

If the design from tb-brainstorming covers multiple independent subsystems, it should have been broken into sub-projects during tb-brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Task Right-Sizing

A task is the smallest unit that carries its own test cycle and is worth a
fresh reviewer's gate. When drawing task boundaries: fold setup,
configuration, scaffolding, and documentation steps into the task whose
deliverable needs them; split only where a reviewer could meaningfully
reject one task while approving its neighbor. Each task ends with an
independently testable deliverable.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

The plan is a **single self-contained HTML file**: clear framed sections, each
with its own colored border so the structure is obvious when the user opens it
in a browser for review. The `- [ ]` text marker is kept next to every HTML
checkbox so `tb-subagent-driven-development` / `tb-executing-plans` can still track
progress.

**Escape `<`, `>`, and `&` inside every code block** (use `&lt;`, `&gt;`,
`&amp;`) so code renders correctly in the browser.

**Every plan MUST start with this header (open the document, embed the
`<style>`, then the title/intro/constraints):**

```html
<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>[ชื่อ Feature] Implementation Plan</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; line-height: 1.55;
         max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1f2933;
         background: #f5f7fa; }
  code, pre { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  pre { background: #1f2933; color: #e4e7eb; padding: .9rem 1rem;
        border-radius: 6px; overflow-x: auto; }
  code { background: #e4e7eb; padding: .1rem .35rem; border-radius: 4px; }
  pre code { background: none; padding: 0; color: inherit; }
  .frame { border-left: 6px solid; border-radius: 8px; padding: 1rem 1.25rem;
           margin: 1.25rem 0; background: #ffffff;
           box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .frame-header     { border-color: #2563eb; background: #eff6ff; }  /* blue  */
  .frame-constraints{ border-color: #d97706; background: #fffbeb; }  /* amber */
  .frame-task       { border-color: #059669; background: #ecfdf5; }  /* green */
  .frame h1, .frame h2, .frame h3 { margin-top: 0; }
  .note { border-color: #7c3aed; background: #f5f3ff; }              /* violet */
  .step { display: flex; gap: .5rem; align-items: baseline;
          margin: .75rem 0 .25rem; }
  .step input { transform: scale(1.2); margin-top: .15rem; }
  .meta { color: #52606d; font-size: .9rem; }
</style>
</head>
<body>

<div class="frame frame-header">
  <h1>[ชื่อ Feature] Implementation Plan</h1>
  <p><strong>เป้าหมาย:</strong> [อธิบายสิ่งที่จะสร้างใน 1 ประโยค]</p>
  <p><strong>สถาปัตยกรรม:</strong> [อธิบายแนวทาง 2-3 ประโยค]</p>
  <p><strong>Tech Stack:</strong> [เทคโนโลยี/ไลบรารีหลัก]</p>
</div>

<div class="frame note">
  <strong>For agentic workers:</strong> REQUIRED SUB-SKILL: Use
  tb-subagent-driven-development (recommended) or
  tb-executing-plans to implement this plan task-by-task. Steps keep
  the <code>- [ ]</code> marker next to each checkbox for tracking.
</div>

<div class="frame frame-constraints">
  <h2>Global Constraints</h2>
  <ul>
    <li>[ข้อกำหนดระดับโปรเจกต์จาก spec — version ขั้นต่ำ, ข้อจำกัด dependency,
        กฎการตั้งชื่อ/ข้อความ, ข้อกำหนดแพลตฟอร์ม — บรรทัดละข้อ คัดค่าจริงมาจาก spec แบบตรงตัว
        (เขียนคำอธิบายเป็นภาษาไทย แต่คงค่า/ชื่อทางเทคนิคไว้ตามต้นฉบับ) ทุก task ถือว่ารวม
        ข้อกำหนดในส่วนนี้โดยปริยาย]</li>
  </ul>
</div>
```

## Task Structure

Each task is its own green-framed box. Every step pairs an HTML checkbox with
the `- [ ]` marker so tracking still works.

```html
<div class="frame frame-task">
  <h3>Task N: [ชื่อ Component]</h3>

  <p class="meta"><strong>ไฟล์:</strong></p>
  <ul class="meta">
    <li>สร้าง: <code>exact/path/to/file.py</code></li>
    <li>แก้ไข: <code>exact/path/to/existing.py:123-145</code></li>
    <li>เทสต์: <code>tests/exact/path/to/test.py</code></li>
  </ul>

  <p class="meta"><strong>Interfaces:</strong></p>
  <ul class="meta">
    <li>ใช้จาก (Consumes): [สิ่งที่ task นี้ใช้จาก task ก่อนหน้า — ระบุ signature ตรงตัว]</li>
    <li>ส่งต่อ (Produces): [สิ่งที่ task ถัดไปต้องพึ่งพา — ชื่อฟังก์ชัน, พารามิเตอร์ และ
        return type ที่ชัดเจน ผู้ทำ task เห็นเฉพาะ task ของตัวเอง บล็อกนี้คือที่ที่เขาจะรู้
        ชื่อและ type ที่ task ข้างเคียงใช้]</li>
  </ul>

  <p class="step"><input type="checkbox"> <span>- [ ] <strong>Step 1: เขียน test ที่ต้อง fail</strong></span></p>
<pre><code>def test_specific_behavior():
    result = function(input)
    assert result == expected</code></pre>

  <p class="step"><input type="checkbox"> <span>- [ ] <strong>Step 2: รัน test เพื่อยืนยันว่า fail</strong></span></p>
  <p>รัน: <code>pytest tests/path/test.py::test_name -v</code><br>
     คาดหวัง: FAIL ด้วย "function not defined"</p>

  <p class="step"><input type="checkbox"> <span>- [ ] <strong>Step 3: เขียน implementation ขั้นต่ำ</strong></span></p>
<pre><code>def function(input):
    return expected</code></pre>

  <p class="step"><input type="checkbox"> <span>- [ ] <strong>Step 4: รัน test เพื่อยืนยันว่า pass</strong></span></p>
  <p>รัน: <code>pytest tests/path/test.py::test_name -v</code><br>
     คาดหวัง: PASS</p>

  <p class="step"><input type="checkbox"> <span>- [ ] <strong>Step 5: Commit</strong></span></p>
<pre><code>git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"</code></pre>
</div>
```

**After the final task, close the document** with `</body>` and `</html>`.

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the agreed design from tb-brainstorming with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Design coverage:** Skim each section/requirement in the design. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Open for Review

After saving the HTML plan, open it in the browser so the user can review it
**before** any execution starts:

Use `execution_subagent` to run: `open "<absolute-path-to-plan>.html"`
- Use the absolute path already known from context — do NOT use `run_in_terminal` for this step
- macOS: `open <path>` | Windows: `start <path>` | Linux: `xdg-open <path>`

## Execution Handoff

Once the plan is open for review, offer the execution choice:

**"Plan complete, saved to `docs/plan/<filename>.html`, and opened in your browser for review. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using tb-executing-plans, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use tb-subagent-driven-development
- Fresh subagent per task + two-stage review

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use tb-executing-plans
- Batch execution with checkpoints for review
