# Money Nest — Mobile-First UI/UX Redesign and Quality Audit

> **Implementation brief for Gemini (coding agent)**  
> **Project:** Money Nest personal finance manager  
> **Live site:** https://money-nest-xi.vercel.app/dashboard  
> **Reference:** [`assets/mobile-ui-reference-original.jpg`](assets/mobile-ui-reference-original.jpg)  
> **Status:** Design and implementation requirements. The live site has been partly inspected, but the codebase, authenticated account and all feature flows have **not** been fully audited. Verify findings in the repository before changing anything.

## 1. Mission

Improve the **existing Money Nest application**, with particular attention to its mobile web experience. Use the attached eight-screen finance-app image as the **visual direction**, not as a replacement for the application's information architecture or a static screenshot to imitate.

The result should feel like a polished, minimal, modern personal finance app on a phone while retaining the deeper functionality of Money Nest: bank accounts, transactions, credit cards, Pay Later, bills, fixed deposits, loans and EMIs, split bills, imports, analytics and settings. The desktop experience should remain practical and coherent.

**Primary goals**

1. Make the app responsive, fast, readable and simple to navigate on small screens.
2. Prioritize a compact overview of balances, spending, upcoming payments and recent activity.
3. Make transactions and account details easy to find, filter, review and correct.
4. Protect financial calculations from duplicates, misclassified transfers and double-counting.
5. Preserve existing working features, user data, authentication, permissions and business logic.
6. Audit and fix **reproducible** functional, accessibility and layout bugs. Distinguish verified bugs from proposed improvements.

**Do not rebuild the project from scratch.** Inspect the existing framework, components, design tokens, database schema and routing first. Prefer focused, testable changes.

## 2. Required visual reference

![User-provided mobile finance UI reference: eight phone screens showing welcome, overview, analytics, transactions, budget, goals, investments, and profile](assets/mobile-ui-reference-original.jpg)

**Important:** This image was provided by the project owner. Use it to understand layout, spacing, hierarchy, colors, card styling and mobile navigation. It is not the brand, not real user data and not a complete list of Money Nest features.

### What to borrow from the image

- Bright, uncluttered surfaces; a restrained deep-green/teal accent; subtle borders and soft shadows.
- Rounded summary cards, clear money figures, compact icon-and-label rows and easy-to-scan transaction lists.
- Mobile-first typography with strong hierarchy: headline balances, section headings, supporting labels, dates and statuses.
- A persistent **five-item bottom navigation bar** on phones.
- Visual charts for trends and categories, with accessible labels and text alternatives.
- Clear states for selected tabs, dates, filters, progress bars and paid/unpaid bills.
- Consistent padding, card corners, icon sizes, spacing, tap areas and navigation transitions.

### What **not** to copy literally

- The reference app's name **Finora**; the product remains **Money Nest**.
- Sample person, email, avatars, account values, transactions or the **$** currency.
- Fictional UI elements that lack a real backing workflow in Money Nest.
- Fake investment returns, fabricated financial health scores or goal progress.
- The image's exact screen proportions if they make the actual web app less usable.

Use **₹** and Indian number formatting where appropriate, for example `₹1,92,142.70`. Preserve existing copy, logo, tagline, account names and transaction details unless a verified issue or explicit requirement calls for a change. Avoid adding unnecessary new wording.

### Reference-to-Money-Nest screen mapping

| Reference screen | Money Nest interpretation | Priority |
| --- | --- | --- |
| Welcome / onboarding | Existing sign-in and demo-entry flow; cleaner mobile presentation | Medium |
| Home | Overview: total bank balance, monthly spending, credit-card usage, Pay Later, upcoming bills and recent activity | Highest |
| Spending Analytics | Existing Analytics: month selection, category totals, trends and comparison | High |
| Transactions | Existing transaction list, search, filters, categorization and editing | Highest |
| Budget | Optional future feature if supported by the existing model; do not invent totals | Future / conditional |
| Financial Goals | Optional future feature; do not show fabricated targets or progress | Future / conditional |
| Investments | Use only for actual supported investments / fixed deposits. Do not display fake market performance | Future / conditional |
| Profile | Settings, privacy, security, preferences, and account actions | Medium |

## 3. What has actually been observed

The following is based on inspection of the public live site and its **fictional demo** on **13 October 2026**. It is **not** an exhaustive end-to-end test.

| Finding | Status | Action |
| --- | --- | --- |
| Unauthenticated visits to `/dashboard` redirect to `/login` | Confirmed | Treat as expected authentication behavior unless the code or product requirements say otherwise. |
| The login page offers an **Explore fictional demo** option | Confirmed | Keep this flow easy to discover and separate from the owner account. |
| Demo overview opens with account, spending, credit-card, Pay Later, bill and activity summaries | Confirmed | Preserve these functional areas in the redesigned overview. |
| Demo navigation contains Overview, Accounts, Transactions, Bills & payments, Pay Later, Fixed deposits, Loans & EMIs, Split bills, Imports and Analytics | Confirmed | Keep all destinations accessible; group them more thoughtfully on mobile. |
| Demo reports pending import items with a count badge | Confirmed | Keep pending imports visible and actionable. |
| Some accessibility names appear duplicated, e.g. `Month Month` and `Show month picker Show month picker` | Confirmed in the inspected accessibility tree | Inspect label composition and correct it without removing accessible names. |
| Mobile layout overflow, clipped text, menu overlap, broken filtering, failing forms or broken calculation paths | **Not verified** | Test these; do not claim they are existing bugs unless reproduced. |
| Owner-account data and protected workflows | **Not accessed** | Do not infer behavior from demo data. Test safely with authorized fixtures, staging or mock data. |

**Demo baseline observed:** selected month October 2026; cards for Total bank balance, This month's spending, Credit card usage, Pay Later usage; sections for Bills to pay and Recent activity. The displayed amounts are fictional sample data, not requirements or expected owner values.

## 4. Core UX requirements

### 4.1 Design system

Create or reuse shared tokens rather than scattering CSS values. Treat the following as **starting suggestions**, not mandatory brand substitutions:

| Token | Suggested direction |
| --- | --- |
| Primary | Deep emerald/teal, approximately `#087B60` |
| Primary dark | Approximately `#075441` |
| Page background | Very light off-white, approximately `#F7FAF9` |
| Card surface | White (`#FFFFFF`) |
| Main text | Nearly black, approximately `#15211E` |
| Secondary text | Muted gray-green, approximately `#687672` |
| Positive | Green, used for deposits/positive movement when semantically appropriate |
| Warning | Amber for upcoming/partial actions |
| Error | Red for errors/overdue statuses (never color alone) |
| Card radius | About 16–20px |
| Control radius | About 10–14px |
| Spacing scale | Consistent 4/8/12/16/24/32px rhythm |
| Touch targets | At least 44×44 CSS pixels |

Use the project's existing typography if readable. Prefer a legible system or well-supported sans-serif stack. Avoid decorative gradients on every card, excessive shadows, low-contrast pale text, tiny statistics, or too many competing colors. Ensure dark mode works if already supported; don't add a half-finished mode.

**Number presentation:** amounts and their signs must remain readable on small screens. Use `tabular-nums` for aligned figures where available, sensible wrapping/truncation rules, and appropriate labels for units and dates.

### 4.2 Responsive layout

**Small phones: 320–374px**
- One main content column; cards fit viewport; never clip rupee amounts.
- Avoid horizontal page scrolling. Allow only intentional horizontal carousels/chips with visible cues.
- Keep major controls reachable with one thumb; allow long merchant names to wrap or truncate safely.

**Common phones: 375–430px**
- Compact header, prominent primary balance card, quick actions, upcoming bills and recent activity.
- Sticky or fixed bottom navigation with safe-area padding.
- Single-column stacked cards, sensible vertical spacing and clear section headers.

**Tablet: 431–1023px**
- Adapt between one- and two-column cards according to actual space.
- Bottom navigation or a compact side rail, depending on tested width and orientation.

**Desktop: 1024px and above**
- Retain a practical sidebar/navigation rail and wider cards/charts.
- Avoid stretching tables or amounts across excessively wide lines.
- Preserve keyboard navigation and efficient workflows for power users.

At all widths, consider safe areas, browser zoom, large fonts, virtual keyboards, long names, empty lists and screen readers. Use responsive CSS/layout primitives already present in the project.

### 4.3 Phone navigation: five destinations

Recommended bottom bar:

1. **Home** — Overview/dashboard.
2. **Accounts** — Bank accounts, credit cards, Pay Later, and account drill-downs.
3. **Transactions** — Search, filter, edit and review financial activity.
4. **Analytics** — Spending trends and categories.
5. **More** — Bills & payments, Fixed deposits, Loans & EMIs, Split bills, Imports, Settings, Data & privacy, Profile, Help and any other existing routes.

Rules:
- Clearly distinguish selected, inactive and disabled states. Labels must remain visible, not icon-only.
- Use genuine navigation links; back behavior should be predictable.
- Do not obscure content, floating buttons or form submit controls with the bottom bar.
- Keep a visible path to all existing features; **no lost routes** during sidebar-to-bottom-nav migration.
- On subpages, show a title/back affordance where appropriate while retaining a sensible path home.
- Add bottom padding: bar height **plus** device safe-area inset.
- Avoid duplicate navigation controls occupying the same area.

## 5. Page-by-page implementation specification

### 5.1 Home / Overview — highest priority

**Above the fold (mobile):**
- Compact header: Money Nest identity, page context, notification indicator (if functional), profile/settings entry.
- Current month selector, using a proper accessible label.
- Large **Total bank balance** card showing its meaning and freshness/last reported date.
- Immediately recognizable quick actions, selected from existing supported functions: **Add transaction**, **Import statement**, **Record payment**, **Transfer**. Do not display nonfunctional buttons.

**Below:**
- This month's spending summary with posted-expense count and link to details.
- Credit-card usage card: used amount, total limit, usage percentage and individual cards (expandable).
- Pay Later usage card: outstanding, limit, usage percentage and providers (expandable).
- Upcoming bills: soonest due date first, creditor, due amount, due date and paid/partial/unpaid/overdue status.
- Recent transactions: merchant/description, date, category, source/account, amount and direction; tappable detail/edit.
- Relevant alerts: unreconciled imports, uncategorized/unconfirmed transactions, upcoming payment due dates.

**Important:** Do not merge bank deposits with available credit; never imply card limits are money owned. Show reported balances and calculated balances with clear distinctions where the underlying data allows it.

### 5.2 Transactions

- Fast search by merchant, description, amount, reference or counterparty where supported.
- Filter chips: **All**, **Income**, **Expenses**, **Transfers**, plus **Unconfirmed** and **Uncategorized** when data supports them.
- Date-range/month, account, payment instrument, category and status filters; a clear **Reset filters** action.
- Group entries by date. Each row has meaningful amount signs, a category/icon, and optional source/account subtitle.
- Tap to inspect or edit the original record. Existing metadata, external reference and linked-account information must remain unchanged unless explicitly edited.
- Safe edit and delete with confirmations where appropriate; deleting a linked or imported transaction must not create orphan records.
- Show refund, transfer, loan, credit card payment, split reimbursement and ordinary expense as different semantic transaction types when supported.
- Show loading, empty, error and no-search-results states.
- Preserve sort order and filter state when returning from transaction details.

**Critical:** Never insert a new transaction when the intended operation is updating an existing matched transaction.

### 5.3 Accounts

Present a friendly grouped overview with categories for:

- **Bank accounts:** reported balance, update date, recent activity, nickname and account-specific detail.
- **Credit cards:** provider, limit, used/outstanding balance, statement date, due date, payment state and utilization.
- **Pay Later:** provider, limit, due/outstanding balance and due date.

Use compact cards on phones and drill-down pages instead of squeezing desktop tables into small widths. Sensitive identifiers must be masked. If there is an account-level reconciliation or manual statement entry flow, preserve it.

### 5.4 Bills & payments

- Show due, paid, partial and overdue states plainly.
- Display outstanding amount, billing period, due date, creditor/payment instrument, and linked payment records when available.
- Sort overdue first, then nearest due, with an optional calendar/list switch if it improves usability.
- On **Record payment**, ask for source account and the bill/card being paid when needed. Link payment to the original liability instead of counting it as a new purchase expense.
- Avoid duplicate bill-payment records and duplicate reminders.

### 5.5 Pay Later

- Separate credit limit, current outstanding, next due date and remaining available limit.
- Track repayments as liability reductions, not as new spending if purchases are already counted.
- When due amounts are unknown, display **Not available** / **Needs confirmation**, never `₹0` unless confirmed zero.

### 5.6 Fixed deposits

- Show institution, principal, current reported/accrued value if available, rate, start date and maturity date.
- Mark estimated values clearly if calculated; don't label them bank-confirmed values.
- Avoid treating a transfer from savings to an FD as an expense or the original principal returning at maturity as income.
- Account for interest separately when supported.

### 5.7 Loans & EMIs

- Show loan principal/current balance where supported, EMI amount, next payment date, paid installments and remaining term.
- Classify loan disbursements and principal repayment correctly: borrowed money is not ordinary income, and principal repayment should not be confused with discretionary spending.
- If the product counts interest/fees in monthly expense analytics, apply a consistent, documented rule.
- Support a clearly labeled **unknown/unconfirmed** amount or schedule instead of invented values.

### 5.8 Split bills / friends

- Track money **owed by you**, **owed to you**, shared purchases and reimbursements.
- Preserve links among the expense, friends, settlements and original account transactions.
- Avoid counting both a shared purchase and its settlement as two expenses.
- Provide visible settled/partially settled/outstanding states, with no assumption that a peer-to-peer transfer is always income or expense.

### 5.9 Imports and reconciliation — high priority

- Offer clear import steps: **Select statement → Preview → Match duplicates → Categorize → Confirm → Import result**.
- Preview account, date, amount, description/reference and detected transaction type before committing.
- Surface likely duplicate records side by side. Users should be able to **Match existing**, **Import new** or **Skip** where appropriate.
- Show distinct counts for new, updated/matched, skipped, errors and requires-review.
- Keep unconfirmed or uncategorized transactions visible until resolved.
- Make re-uploading the same statement **idempotent** wherever possible.
- Provide undo/rollback if already supported, or a safe, auditable correction process.

### 5.10 Analytics

- Month/week/year selectors where the underlying data supports each period.
- Spending totals broken down by category with both chart and readable numbers.
- Trend chart with labeled axes, sensible periods and comparable previous-period figures.
- Account and category filters, plus an explicit explanation of which transaction types count as spending.
- Do not show fabricated insights or growth percentages without supporting data.
- Tooltips should work by touch, not only hover. Use a text summary alongside each meaningful chart.

### 5.11 Settings / profile / privacy

- Preserve profile, preferences, account management, notifications (if implemented), privacy/security and sign-out flows.
- Clarify demo vs owner account. Show a distinct **Demo mode** label on sample data.
- Mask sensitive identifiers; do not show full account numbers in cards or screenshots.
- Preserve existing sign-in, password reset and session behavior. Do not weaken authentication to simplify development.

### 5.12 Budget, Goals, Investments — conditional, not assumed

The reference image includes these screens. They may be planned rather than implemented in Money Nest. **Inspect existing models and routes.** If absent, do not invent a working budget, goal or investment product as part of this visual redesign. Document recommended extensions separately and build them only when approved. Fixed deposits can have an appropriately designed account view without pretending to be stock-market investments.

## 6. Financial accuracy and duplicate-prevention rules

These rules outrank decorative UI choices.

| Case | Required behavior |
| --- | --- |
| Expense paid by bank/card/Pay Later | Record genuine purchase once; associate correct instrument/account. |
| Credit-card bill payment | Reduce card liability and bank balance; do not count as a second spending event. |
| Pay Later repayment | Reduce liability and source balance; do not count the original purchase twice. |
| Transfer between owned accounts | Reflect both sides / linked movement without classifying as income or expense. |
| Loan disbursement | Show as loan liability/cash inflow, **not** normal earned income. |
| Loan principal repayment | Reduce liability; distinguish interest/fees per documented policy. |
| Refund/reversal | Connect to original purchase where possible; don't label as salary or ordinary income. |
| Split expense and reimbursement | Keep split ledger and actual cash movement consistent, without double-counting spend. |
| FD creation or maturity | Treat principal movements as asset transfers; separate earned interest. |
| Unknown purpose or unclear reference | Preserve as **Unconfirmed**; ask the owner before merging or categorizing. |

**Duplicate matching principles**

1. If available, use a stable bank/processor transaction reference scoped to the appropriate account/instrument and owner.
2. For imports lacking a unique reference, compare account, date/time (allow legitimate timezone differences), amount, direction, normalized description and statement source.
3. Do **not** automatically merge merely because two payments have the same merchant and amount on the same day.
4. Assign a stable import/batch identifier and record provenance without exposing sensitive financial data unnecessarily.
5. Handle repeated uploads and partial retries without creating duplicates.
6. Prefer updating an explicit existing record over inserting a new one when the user directs an update.
7. When confidence is insufficient, create a review candidate or retain the original as unconfirmed; do not silently guess.
8. Recompute relevant summaries after corrections. Test the entire chain: transaction → account/liability → bill → analytics.
9. Keep audit records/version history where the existing backend supports them.

**Data minimization and security:** keep secrets server-side, respect access controls on every financial record, isolate owner and demo storage, protect imported files, and avoid logging account numbers or sensitive transaction descriptions in analytics/logs. Do not perform destructive migrations without backups and explicit authorization.

## 7. Forms, validation and status behavior

- Forms must have visible labels, useful validation and clear required/optional fields.
- Support decimal currency values accurately; avoid floating-point rounding mistakes by using the project's money utilities or integer minor units.
- Confirm destructive actions. Provide an actionable success or error message after submission.
- Prevent double-submit with disabled/pending submit states and idempotency where supported.
- Keep existing values when editing; do not reset unchanged fields.
- Never make a false `₹0.00` default for unknown balances or due dates.
- Support search/filter empty states, loading skeletons and retryable errors.
- Handle server/network failures without losing typed data unnecessarily.

## 8. Accessibility and readability

Follow WCAG 2.2 AA as the target where feasible. Specifically:

- Correct the confirmed duplicated accessible names of month-picker controls.
- Provide unique labels for icon-only buttons and every form control.
- Keep heading structure logical, focus states visible and keyboard/tab order predictable.
- Use proper links for navigation, buttons for actions, and dialogs with focus management.
- Aim for normal-text contrast ≥ 4.5:1 and large-text/icon contrast appropriate for the element.
- Do not rely on color alone for positive/negative amounts or paid/overdue statuses.
- Ensure content works at 200% zoom, larger system text and 320px wide screens.
- Include accessible table headers, meaningful chart descriptions and keyboard-operable filters.
- Honor reduced-motion preferences. Avoid ornamental animations that block interaction.

## 9. Performance and resilience

- Avoid loading every chart and long transaction list on the first screen.
- Use existing route-level code splitting/lazy loading as appropriate.
- Paginate or virtualize large lists only if needed and accessible.
- Optimize image and icon sizes; avoid oversized illustration assets.
- Minimize layout shifts. Provide clear loading states when data is fetching.
- Ensure mobile page interactions remain usable on average devices and unreliable networks.
- Preserve current persistence and synchronization behavior. Never claim offline support unless it is implemented and tested.
- Don't add heavy UI packages when existing dependencies provide the same function.

## 10. Test matrix

Run tests in the repository and use a real or automated browser when possible.

| Environment | Required checks |
| --- | --- |
| 320px and 360px wide phones | No horizontal page overflow, cut-off totals, unreachable actions or occluded content. |
| 390px and 430px phones | Bottom navigation, safe-area spacing, compact cards, transaction filters and modal behavior. |
| 768px tablet | Cards reflow correctly; navigation adapts; no awkward empty space. |
| 1024px laptop | Desktop/tablet transition; charts and tables remain usable. |
| 1440px desktop | Sidebar, dashboard alignment, table readability and information hierarchy. |
| Keyboard and screen reader | Tab order, visible focus, unique names, dialog behavior, selected tabs and live status messages. |
| Owner vs demo mode | Strict data isolation and correct authentication/session controls. |
| Import same statement twice | No repeated ledger entries; review screen handles duplicates. |
| Update existing transaction | Updates one exact record without adding another. |
| Transfer between owned accounts | Bank balances reconcile; monthly spending remains unaffected. |
| Credit-card payment | Liability and source balance update; spending not duplicated. |
| Refund and reimbursement | Correct linking and category / analytic treatment. |
| Empty/failed loading states | Meaningful message, no invented amount, retry where applicable. |

Also test: form submit twice, slow network, back/forward navigation, deep links, very long descriptions, amounts with large Indian groupings, negative balances, zero-value confirmed records and date/time boundaries.

## 11. Acceptance criteria (definition of done)

The redesign is complete only when all applicable points pass:

- [ ] The owner can navigate every existing feature from mobile **without** a desktop-only sidebar.
- [ ] The mobile overview is clear and useful at 360px and 390px.
- [ ] Five-item bottom navigation is accessible, active-state aware and never blocks content.
- [ ] All original routes and meaningful actions still work; no existing owner data is lost.
- [ ] Home shows real, correctly described balances, liabilities, bills and transactions.
- [ ] Transactions support the existing edit, search, filter and review workflows.
- [ ] Reimporting a statement does not silently duplicate confirmed entries.
- [ ] Account transfers, card repayments, loan principal and refunds are not incorrectly treated as new spending/income.
- [ ] Verified accessibility issue(s), including duplicate month labels, are fixed.
- [ ] Major forms have validation, pending, error and success states.
- [ ] Screens pass responsive checks from 320px to desktop, with no unintended overflow.
- [ ] Charts are readable and have non-visual equivalents.
- [ ] Demo data and owner data remain isolated.
- [ ] Automated tests/build/lint pass, or any pre-existing failures are documented with evidence.
- [ ] Before/after screenshots are produced for Home, Transactions, Analytics and Accounts in mobile and desktop sizes.
- [ ] Final report lists changed files, tests run, results, verified bugs, remaining limitations and deferred features.

## 12. Execution plan for Gemini

### Phase 0 — Repository audit (do this first)

1. Identify framework, routing, component structure, CSS/style system, UI dependencies, store/state pattern, DB/API integration, authentication boundaries and existing tests.
2. Map every current route and its purpose; identify the shared layouts, forms, charts and navigation.
3. Check whether the app has a mobile layout already. Record actual breakpoints and reproducible bugs with screenshots and viewport sizes.
4. Trace financial metrics back to source records and inspect existing duplicate detection and import logic.
5. Save a short **audit report** before making changes, with a distinction between facts and assumptions.

### Phase 1 — Shared UI foundation

1. Reuse/refine tokens, typography, card styles, icons, inputs and responsive primitives.
2. Build adaptive navigation: desktop sidebar, mobile bottom bar, accessible page headers.
3. Ensure safe-area insets, dialog behavior and mobile keyboard handling.
4. Fix accessible labels and visible focus states.

### Phase 2 — Core mobile screens

1. Home / Overview.
2. Transactions / detail / filtering / edit.
3. Accounts, credit cards and Pay Later.
4. Analytics.
5. Bills and related due-date workflows.

Preserve existing data sources and business rules. Test each screen before moving on.

### Phase 3 — Supporting screens and accuracy checks

1. Fixed deposits, Loans & EMIs, Split bills, Imports, Settings and Data & privacy.
2. Test reconciliation, duplicate handling and transaction categorization.
3. Add status and empty/error states where missing.
4. Identify optional future Budget/Goals/Investment screens but do not fabricate data or features.

### Phase 4 — Verification and handoff

1. Run build, lint, unit/integration tests and E2E tests available in the repository.
2. Test mobile/tablet/desktop viewport matrix and keyboard/screen-reader basics.
3. Capture before-and-after screenshots where browser access permits.
4. Deliver code changes **plus** a short report: what changed, verified issues corrected, tests, open issues and follow-up priorities.

**Change-control rule:** If a task could remove stored data, change financial semantics, alter authentication, rewrite an established workflow, require paid infrastructure, or create unsupported features, stop and ask for approval. Otherwise implement the smallest safe improvement and explain it.

## 13. Instructions to Gemini when this README is opened

Treat this README and `assets/mobile-ui-reference-original.jpg` as the primary product brief. Inspect the repository before writing code. The source image is a visual direction; the current application's data model and working business features are authoritative. Do not simply generate a screenshot-like static page.

**Your response and deliverables should follow this order:**

1. **Current architecture:** summarize framework, main routes/components, data flow, and constraints found in the code.
2. **Verified bugs and UX problems:** include evidence, affected route/component, viewport, severity and reproduction steps. Separate unverified risks.
3. **Implementation plan:** specify the component and page changes you will make, prioritizing mobile navigation, Overview and Transactions.
4. **Implementation:** change the actual repository code without removing existing functions or financial data.
5. **Testing:** run available checks and document results. Show screenshots if possible.
6. **Handoff:** changed files, decisions made, open risks and what needs project-owner confirmation.

If you cannot open the website, run the app, inspect the attached image or test a workflow, say so explicitly. Do not invent screenshots, test outcomes or bug reproductions. When a calculation rule is not defined by the code or product, ask rather than guessing.

---

### Asset manifest

- `README.md` — this complete brief, including implementation order and acceptance criteria.
- `assets/mobile-ui-reference-original.jpg` — the **exact user-provided** eight-screen reference image.

To give Gemini the visual reference, upload **both** files or extract the included ZIP into the root of the repository, keeping the relative path intact. Gemini should be able to read the README and the image together.
