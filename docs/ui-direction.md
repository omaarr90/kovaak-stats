# UI Direction

## Product Type

KovaaK Stats should be a desktop-first game stats UI.

More specifically: it should feel like an offline aim-training command center, not a marketing landing page, not a generic BI dashboard, and not a flashy "gamer HUD".

## North Star

The UI should answer three questions fast:

1. What should I practice next?
2. What is improving or slipping?
3. Is live tracking working right now?

If a screen does not help answer one of those questions, it should be secondary.

## Design System Base

Use a Fluent-adjacent desktop shell as the base language because this app is Windows-first, then layer game-training data patterns on top.

That means:

- Native-feeling typography and spacing
- Calm surfaces with strong contrast
- Clear focus states and keyboard navigation
- Dense but readable data panels
- Functional motion only

Use semantic design tokens as the source of truth. Keep tokens centralized in the frontend theme and avoid one-off colors, spacing values, or shadows in component code.

## Visual Direction

The look should be "tactical performance console".

Use these visual rules:

- Dark, low-glare canvas with elevated panels
- Cool accent color for active state and live data
- Green only for improvement, red only for decline, amber only for caution
- Strong type hierarchy over decorative graphics
- Charts and tables should read as tools, not decoration

Avoid:

- Neon overload
- Heavy glassmorphism
- Oversized hero sections
- Ambiguous icon-only controls
- Motion that exists only to look impressive

## Information Architecture

The current four-view structure is the right direction.

### Today (`src/views/TodayView.tsx`)

This is the home screen and should behave like a coach brief.

Priority order:

1. Next recommended block
2. Live session state
3. Readiness and risk signals
4. First-run blockers when setup is incomplete

This screen should stay brief. It should push deeper analysis and plan editing into their own workspaces instead of becoming a dumping ground for every metric.

### Analysis (`src/views/AnalysisView.tsx`)

This is the deep-work workspace.

It should be optimized for:

- Comparing time and quality over time
- Filtering scenarios quickly
- Keeping one selected scenario in focus while other controls change
- Moving between calendar, explorer, and inspector without losing context

This view should feel like a desktop analytics tool: stable layout, sticky headers where useful, and minimal surprise.

### Practice (`src/views/PracticeView.tsx`)

This is the action workspace.

It should combine:

- Live session companion
- Plan builder
- Focus area management
- Playlist mapping for tracking accuracy

This screen should favor clear control states and explicit save/apply moments. It is more operational than analytical.

### Settings (`src/views/SettingsView.tsx`)

This should stay utilitarian.

Settings is for trust, diagnostics, and recovery:

- Path detection
- Refresh/update behavior
- Tray and startup behavior
- Tracker health

Do not make Settings visually compete with Today or Analysis.

## Layout Rules

Use a stable app shell with a sticky command header and one main content region.

Layout guidance:

- Keep the header focused on identity, refresh state, and section switching
- Use cards for grouped decisions, not for every single data point
- Favor two-column desktop workspaces for analysis and operations
- Collapse to one column cleanly on narrow widths without hiding critical controls
- Preserve selected state during refreshes and filter changes

For this app, density is good when it improves scan speed. Empty space should create structure, not theatrical minimalism.

## Component Rules

The existing primitive set is the right foundation:

- `PanelCard`
- `SectionHeader`
- `MetricChip`
- `DataTable`

Direction for primitives:

- `PanelCard` is the default container for one task or one data story
- `SectionHeader` should always explain why the panel exists, not just repeat a title
- `MetricChip` is for quick status reads, usually 3 to 6 at a time
- `DataTable` is for comparison and scanning, not long-form detail

Prefer native HTML semantics first:

- Real `button`, `input`, `label`, `select`, `table`
- Search fields with real `type="search"`
- Button groups for view switching and filter presets
- Clear text labels before custom affordances

## Accessibility Baseline

Accessibility is not optional for this UI direction.

Implementation rules:

- Minimum interactive target: 44x44 CSS px
- Visible focus ring on every interactive control
- Full keyboard navigation across navigation, filters, tables, and calendar
- Do not encode status by color alone
- Keep contrast strong on text, borders, charts, and selected states
- Respect `prefers-reduced-motion`
- Keep screen-reader labels explicit on calendar cells, status controls, and filter inputs

## Feedback and Loading

Loading and refresh behavior should feel reliable, not dramatic.

Rules:

- Preserve the current screen and selected item during background refresh
- Show last refresh time in a low-noise place
- Put errors near the affected panel when possible
- Use toasts for short live milestones, not for critical failures
- For long work such as updates or saves, show progress plus the next expected outcome

## Motion

Motion should confirm state change, not decorate the app.

Use short transitions for:

- View swaps
- Toast entry/exit
- Selection and hover feedback
- Progress changes

Keep durations short and consistent. Every motion path needs a reduced-motion equivalent.

## Content Tone

The voice should be direct, calm, and evidence-based.

Good:

- "Review at-risk scenarios"
- "Tracker is connected and waiting for the next KovaaK session"
- "Play more scored scenarios to unlock trend quality"

Avoid:

- Hype language
- Vague encouragement
- Overstating confidence in recommendations

## Success Metrics

Judge the UI by clarity and task completion, not visual novelty.

Track:

- How quickly a user can identify the next drill
- Whether live tracking state is obvious without opening Settings
- Whether Analysis keeps context while filtering
- Whether Practice makes plan editing and playlist mapping low-friction
- Runtime UX metrics such as INP, LCP, and CLS for the frontend shell

## Immediate Product Direction

If the team needs one sentence to align on the UI:

KovaaK Stats should look and behave like a focused desktop coaching console that turns raw local play history into clear daily action, trustworthy analysis, and low-friction live tracking.

## Next UI Pass Priorities

1. Keep `Today` as the decision-first home screen and resist adding deep analytics there.
2. Make `Analysis` the most stable and information-dense workspace in the app.
3. Keep `Practice` operational, with explicit controls, saves, and live-state clarity.
4. Continue consolidating color, spacing, radius, and motion values into semantic tokens.
5. Audit all clickable surfaces for target size, focus visibility, and keyboard access.
