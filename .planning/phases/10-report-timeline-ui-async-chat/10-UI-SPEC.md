---
phase: 10
slug: report-timeline-ui-async-chat
status: approved
reviewed_at: 2026-04-21
shadcn_initialized: false
preset: none
created: 2026-04-21
---

# Phase 10 — UI Design Contract

> Visual and interaction contract for the Report Timeline + Async Chat webview panel. All values use VSCode CSS variables for automatic light/dark theme support.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none |
| Preset | not applicable |
| Component library | none (plain React + CSS) |
| Icon library | unicode characters (codicons unavailable in webviews) |
| Font | `var(--vscode-font-family)` / `var(--vscode-editor-font-family)` for code |

---

## Spacing Scale

All values are multiples of 4, consistent with VSCode native density and existing panels (dashboard.css, chat.css).

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline badge padding, dot spacing |
| sm | 8px | Compact element spacing, card inner gaps, button gaps |
| md | 12px | Card padding horizontal, message bubble padding |
| lg | 16px | Section padding, timeline feed padding, detail gaps |
| xl | 20px | Panel horizontal padding |
| 2xl | 32px | Empty state padding |

Exceptions: none — matches dashboard.css and chat.css patterns exactly.

---

## Typography

All sizes use VSCode CSS variables. Follows the established 13px base from dashboard.css.

| Role | Size | Weight | Line Height | Variable |
|------|------|--------|-------------|----------|
| Body | 13px | 400 | 1.4 | `var(--vscode-font-size, 13px)` |
| Label | 11px | 400 | 1.2 | — |
| Label bold | 11px | 600 | 1.2 | — |
| Section heading | 13px | 600 | 1.4 | — |
| Card title | 13px | 600 | 1.4 | — |
| Timestamp | 11px | 400 | 1.2 | — |
| Filter tab | 13px | 600 | 1 | — |
| Metric value | 13px | 600 | 1.2 | `var(--vscode-editor-font-family)` for monospace |
| Chart axis label | 10px | 400 | 1 | — |

---

## Color

All colors are VSCode CSS variables. No hardcoded hex values except `rgba()` overlays (which adapt to both themes).

| Role | Variable | Usage |
|------|----------|-------|
| Background | `var(--vscode-editor-background)` | Panel background |
| Foreground | `var(--vscode-foreground)` | Primary text |
| Description | `var(--vscode-descriptionForeground)` | Secondary text, timestamps, labels |
| Card border | `var(--vscode-widget-border)` | Card dividers, section borders |
| Panel border | `var(--vscode-panel-border)` | Composer border-top, header border-bottom |
| Button primary bg | `var(--vscode-button-background)` | Send button, primary actions |
| Button primary fg | `var(--vscode-button-foreground)` | Send button text |
| Button hover | `var(--vscode-button-hoverBackground)` | Send button hover |
| Focus ring | `var(--vscode-focusBorder)` | Focus-visible outline, active tab underline |
| Input bg | `var(--vscode-input-background)` | Composer textarea |
| Input border | `var(--vscode-input-border)` | Composer textarea border |
| Input fg | `var(--vscode-input-foreground)` | Composer textarea text |
| Selection bg | `var(--vscode-list-activeSelectionBackground)` | Active filter tab |
| Hover bg | `var(--vscode-list-hoverBackground)` | Hoverable elements |
| Tab inactive bg | `var(--vscode-tab-inactiveBackground)` | Inactive filter tabs |
| Tab active bg | `var(--vscode-tab-activeBackground)` | Active filter tab background |
| Badge bg | `var(--vscode-badge-background)` | Count badges on filter tabs |
| Badge fg | `var(--vscode-badge-foreground)` | Count badge text |
| Error fg | `var(--vscode-errorForeground)` | Blocker call-out text, negative deltas |
| Warning bg | `var(--vscode-inputValidation-warningBackground)` | Blocker call-out background |
| Warning border | `var(--vscode-inputValidation-warningBorder)` | Blocker call-out border |
| Success/positive | `var(--vscode-terminal-ansiGreen)` | Positive deltas in ralph cards |
| Negative | `var(--vscode-terminal-ansiRed)` | Negative deltas in ralph cards |
| Chart line colors | `var(--vscode-charts-blue)`, `var(--vscode-charts-green)`, `var(--vscode-charts-yellow)`, `var(--vscode-charts-orange)`, `var(--vscode-charts-red)`, `var(--vscode-charts-purple)` | One per metric polyline |
| Code bg | `var(--vscode-textCodeBlock-background)` | Metric value backgrounds |
| User bubble bg | `var(--vscode-textBlockQuote-background)` | User chat messages (matches chat.css) |
| Agent bubble bg | transparent | Agent chat messages (matches chat.css) |
| Link fg | `var(--vscode-textLink-foreground)` | Clickable links in reports |

### Accent usage (restricted)

Accent color (`var(--vscode-button-background)`) is reserved for:
- Send button in MessageComposer
- Active filter tab underline
- Reply button on report cards
- Nothing else — all other interactive elements use transparent/hover patterns

---

## Component Specifications

### 1. ReportPanel (root layout)

```
+--------------------------------------------------+
| [Header: workspace name + connection status]      |
+--------------------------------------------------+
| [FilterTabs: All | Briefings | Ralph | Chat]     |
+--------------------------------------------------+
|                                                    |
| [Load more]                                        |
|                                                    |
| [TimelineItem — report card or chat bubble]        |
| [TimelineItem — report card or chat bubble]        |
| [TimelineItem — report card or chat bubble]        |
| ...                                                |
|                                                    |
+--------------------------------------------------+
| [MessageComposer: textarea + Send]                |
+--------------------------------------------------+
```

- Root: `display: flex; flex-direction: column; height: 100vh;`
- Header: fixed height 35px, flex-shrink: 0
- FilterTabs: fixed height 32px, flex-shrink: 0
- Timeline feed: `flex: 1; overflow-y: auto;`
- Composer: sticky bottom, flex-shrink: 0

### 2. PanelHeader

| Property | Value |
|----------|-------|
| Height | 35px |
| Padding | 0 16px |
| Background | `var(--vscode-sideBar-background)` |
| Border bottom | 1px solid `var(--vscode-widget-border)` |
| Layout | flex, align-items: center, justify-content: space-between |

Contents:
- Left: workspace name (13px, weight 600, ellipsis overflow)
- Right: connection status pill — same pattern as chat.css `.chat-header-state`:
  - Connected: green text `var(--vscode-charts-green)`, rgba bg
  - Stale: yellow text `var(--vscode-charts-yellow)`, rgba bg
  - Error: red text `var(--vscode-errorForeground)`, rgba bg
  - Font: 11px, weight 600, padding 1px 8px, border-radius 9px

### 3. FilterTabs

| Property | Value |
|----------|-------|
| Height | 32px |
| Background | `var(--vscode-sideBar-background)` |
| Border bottom | 1px solid `var(--vscode-widget-border)` |
| Layout | flex, align-items: center, gap: 0 |

Tab item:
- Padding: 0 12px
- Height: 32px (fills container)
- Font: 13px, weight 600
- Inactive: `color: var(--vscode-tab-inactiveForeground); background: transparent`
- Hover: `background: var(--vscode-list-hoverBackground)`
- Active: `color: var(--vscode-tab-activeForeground); border-bottom: 2px solid var(--vscode-focusBorder)`
- Each tab shows count badge: `(N)` — e.g., "Briefings (3)"
- Badge: font-size 11px, padding 0 4px, border-radius 8px, `var(--vscode-badge-background/foreground)`

Tabs: **All** | **Briefings** | **Ralph** | **Chat**

Focus: tab is a `<button>` with `role="tab"`, tablist has `role="tablist"`. Arrow keys navigate between tabs. `focus-visible` shows outline.

State persistence: active tab stored via `vscode.setState()`.

### 4. TimelineFeed

| Property | Value |
|----------|-------|
| Padding | 12px 16px |
| Gap | 8px between items |
| Layout | flex column |
| Scroll | overflow-y: auto |
| Scrollbar | 6px width, same as chat.css scrollbar styling |

Items render newest-first. Each item is a `TimelineItem` with `kind: 'report' | 'message'`.

### 5. BriefingReportCard

| Property | Value |
|----------|-------|
| Border | 1px solid `var(--vscode-widget-border)` |
| Border-radius | 4px |
| Background | transparent |
| Padding | 0 (sections have internal padding) |

Layout:
```
+--------------------------------------------------+
| [Report icon] Briefing Report     [timestamp]     |  <- card header
+--------------------------------------------------+
| !! BLOCKERS (if any)                              |  <- always expanded
| [amber/red call-out box with blocker list]        |
+--------------------------------------------------+
| > Goals (3)                                       |  <- collapsed
| > Progress: 60% complete                          |  <- collapsed
| > Next Steps (2)                                  |  <- collapsed
| > Metrics: 4 values                               |  <- collapsed
+--------------------------------------------------+
| [Reply]                                           |  <- card footer
+--------------------------------------------------+
```

**Card header:**
- Padding: 8px 12px
- Layout: flex, align-items: center, gap: 8px
- Icon: unicode `\u{1F4CB}` (clipboard) — font-size 14px
- Title: "Briefing Report" — 13px, weight 600
- Timestamp: right-aligned, 11px, `var(--vscode-descriptionForeground)` — relative format ("2h ago", "Yesterday")

**Blocker call-out (visible only when `blockers.length > 0`):**
- Margin: 0 12px 8px
- Padding: 8px 12px
- Background: `var(--vscode-inputValidation-warningBackground)`
- Border: 1px solid `var(--vscode-inputValidation-warningBorder)`
- Border-left: 3px solid `var(--vscode-errorForeground)`
- Border-radius: 4px
- Header: `\u26A0` + " Blockers" — 13px, weight 600, `var(--vscode-errorForeground)`
- Each blocker: `\u2022` bullet, 13px, normal weight, `var(--vscode-foreground)`

**Collapsible sections:**
- Use `<details><summary>` native HTML elements
- Summary line padding: 6px 12px
- Summary text: 13px, weight 600, cursor: pointer
- Summary right side: one-line preview in `var(--vscode-descriptionForeground)`, 11px
- Expanded content: padding 4px 12px 8px 24px
- Hover on summary: `background: var(--vscode-list-hoverBackground)`

Section one-line summaries:
- Goals: "Goals (N)" where N is array length
- Progress: "Progress: {progressSummary}" — first 60 chars of progress text
- Next Steps: "Next Steps (N)"
- Metrics: "Metrics: N values"

**Metrics section (expanded):**
- Grid layout: 2 columns, key-value
- Key: 11px, `var(--vscode-descriptionForeground)`
- Value: 13px, weight 600, `var(--vscode-editor-font-family)` (monospace)

**Card footer:**
- Padding: 6px 12px
- Border-top: 1px solid `var(--vscode-widget-border)`
- Reply button: text-only button, 11px, weight 600, `var(--vscode-textLink-foreground)`, no border, padding 2px 8px
- Reply hover: `background: var(--vscode-list-hoverBackground)`, border-radius 3px

### 6. RalphLoopReportCard

| Property | Value |
|----------|-------|
| Border | 1px solid `var(--vscode-widget-border)` |
| Border-radius | 4px |
| Background | transparent |

Layout:
```
+--------------------------------------------------+
| [Loop icon] Ralph Loop #N         [timestamp]     |  <- card header
+--------------------------------------------------+
| What changed: ...                                 |  <- summary
| Cumulative: ...                                   |
+--------------------------------------------------+
| Metric     | Baseline | Current | Delta           |  <- metrics table
| accuracy   | 0.72     | 0.85    | +0.13           |
| latency_ms | 340      | 280     | -60             |
+--------------------------------------------------+
| > Show convergence chart                          |  <- collapsed (2+ iterations)
+--------------------------------------------------+
| [Reply]                                           |
+--------------------------------------------------+
```

**Card header:**
- Same pattern as BriefingReportCard header
- Icon: unicode `\u{1F504}` (counterclockwise arrows)
- Title: "Ralph Loop #{iterationNumber}" — 13px, weight 600
- Subtitle under title: "Loop: {loopId short}" — 11px, `var(--vscode-descriptionForeground)`, first 8 chars of loopId

**Summary section:**
- Padding: 8px 12px
- "What changed:" label (11px, weight 600) + value (13px, normal)
- "Cumulative:" label (11px, weight 600) + value (13px, normal)

**Metrics table:**
- Padding: 0 12px 8px
- Table: width 100%, border-collapse: collapse
- Header row: 11px, weight 600, `var(--vscode-descriptionForeground)`, text-transform uppercase, letter-spacing 0.5px
- Header border-bottom: 1px solid `var(--vscode-widget-border)`
- Body cells: 13px, `var(--vscode-editor-font-family)` (monospace), padding 4px 8px
- Delta cell color:
  - Positive value: `var(--vscode-terminal-ansiGreen)`, prefix "+"
  - Negative value: `var(--vscode-terminal-ansiRed)`, no prefix (already has "-")
  - Zero: `var(--vscode-descriptionForeground)`

**Convergence chart toggle:**
- Only visible when 2+ iterations exist for this loopId
- `<details><summary>` — "Show convergence chart"
- Same styling as BriefingReportCard collapsible sections

**Card footer:** Same as BriefingReportCard (Reply button).

### 7. RalphLoopChart (SVG convergence chart)

| Property | Value |
|----------|-------|
| Width | 100% of card content area |
| Height | 160px |
| Padding | 8px 12px |
| Background | transparent |

Pure SVG, no D3 dependency. Manual coordinate computation.

**Chart elements:**
- `<svg>` with viewBox computed from data range
- Internal padding: top 8px, right 12px, bottom 24px, left 40px (for axis labels)
- Grid lines: horizontal only, stroke `var(--vscode-widget-border)`, stroke-width 0.5, opacity 0.5
- X-axis labels: iteration numbers, 10px, `var(--vscode-descriptionForeground)`, text-anchor: middle
- Y-axis labels: metric values (auto-scaled), 10px, `var(--vscode-descriptionForeground)`, text-anchor: end
- One `<polyline>` per named metric:
  - `fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round;`
  - Colors cycle through VSCode chart palette in order: `var(--vscode-charts-blue)`, `var(--vscode-charts-green)`, `var(--vscode-charts-yellow)`, `var(--vscode-charts-orange)`, `var(--vscode-charts-red)`, `var(--vscode-charts-purple)`
- Data points: `<circle>` r=2.5 at each iteration, same color as polyline
- Hover on data point: r increases to 4, show tooltip with metric name + value

**Legend:**
- Below chart, inside card
- Layout: flex, flex-wrap, gap 12px
- Each item: colored square (8x8px, border-radius 2px) + metric name (11px)

### 8. ChatBubble

Follows chat.css patterns (`.chat-msg-user`, `.chat-msg-assistant`) adapted for the timeline feed.

**User message (direction: 'to_agent'):**

| Property | Value |
|----------|-------|
| Align-self | flex-end |
| Max-width | 80% |
| Background | `var(--vscode-textBlockQuote-background)` |
| Border | 1px solid `var(--vscode-widget-border)` |
| Padding | 8px 12px |
| Border-radius | 6px |

- Sender label: "You" — 11px, weight 600, uppercase, letter-spacing 0.5px, `var(--vscode-descriptionForeground)`, margin-bottom 3px
- Timestamp: next to label, 11px, `var(--vscode-descriptionForeground)`, right-aligned
- Body: 13px, white-space: pre-wrap, word-break: break-word

**Agent message (direction: 'from_agent'):**

| Property | Value |
|----------|-------|
| Align-self | flex-start |
| Max-width | 80% |
| Background | transparent |
| Padding | 8px 12px |
| Border-radius | 6px |

- Sender label: "Agent" — same styling as "You"
- Body: 13px, same as user

**Entrance animation:** Same as chat.css — `chat-fade-in` 0.2s ease-out (translateY 4px).

### 9. MessageComposer

Fixed at panel bottom. Matches chat.css `.chat-input-area` pattern.

| Property | Value |
|----------|-------|
| Padding | 8px 12px 10px |
| Border-top | 1px solid `var(--vscode-panel-border)` |
| Background | `var(--vscode-editor-background)` |
| Layout | flex, align-items: flex-end, gap: 8px |
| Flex-shrink | 0 |

**Reply indicator (visible when replying to a report):**
- Above the textarea, inside the composer area
- Padding: 4px 8px
- Background: `var(--vscode-textBlockQuote-background)`
- Border-left: 2px solid `var(--vscode-textLink-foreground)`
- Border-radius: 2px
- Text: "Replying to briefing report from {timestamp}" — 11px, `var(--vscode-descriptionForeground)`
- Dismiss button: unicode `\u2715` (x mark), transparent bg, 11px, padding 2px, cursor pointer

**Textarea:**
- `flex: 1`
- Background: `var(--vscode-input-background)`
- Border: 1px solid `var(--vscode-input-border)`
- Border-radius: 4px
- Padding: 8px 10px
- Font: inherit
- Resize: none
- Min-height: 36px, max-height: 120px
- Focus: `border-color: var(--vscode-focusBorder)`
- Placeholder: "Message your agent... (Enter to send)"

**Send button:**
- Background: `var(--vscode-button-background)`
- Color: `var(--vscode-button-foreground)`
- Hover: `var(--vscode-button-hoverBackground)`
- Padding: 6px 14px
- Border: none
- Border-radius: 4px
- Disabled: opacity 0.5 (when textarea is empty)
- Text: "Send"

**Keyboard:** Enter sends, Shift+Enter newline. Matches chat.css pattern.

### 10. LoadMoreButton

| Property | Value |
|----------|-------|
| Align-self | center |
| Margin | 8px 0 |
| Padding | 4px 16px |
| Background | transparent |
| Border | 1px solid `var(--vscode-widget-border)` |
| Border-radius | 4px |
| Font | 11px, weight 600 |
| Color | `var(--vscode-descriptionForeground)` |
| Cursor | pointer |

- Hover: `background: var(--vscode-list-hoverBackground)`
- Loading state: text changes to "Loading..." with disabled state
- Position: top of timeline feed (before newest item, since we're loading older items)

### 11. EmptyState

Centered in timeline feed area when no items. Matches dashboard.css `.empty-state`.

| Property | Value |
|----------|-------|
| Padding | 32px |
| Layout | flex column, align-items: center, gap: 8px |
| Text color | `var(--vscode-descriptionForeground)` |

---

## Interaction States

### Loading state (initial panel open)
- Timeline area shows centered spinner: three dots animation (same as chat.css `.chat-msg-typing`)
- Filter tabs show "All" active with no counts

### Error state (relay unreachable)
- Header status pill shows "Error" in red
- Timeline area shows error empty state (see copywriting)

### Stale state (no recent heartbeat)
- Header status pill shows "Stale" in yellow
- Reports still render normally — stale indicates agent may not respond to messages

### Reply flow
1. User clicks "Reply" on a report card
2. Composer shows reply indicator bar above textarea
3. Textarea receives focus
4. User types and sends — message includes `inReplyToReportId`
5. Reply indicator clears after send

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Panel title | "HarnessTune Reports - {workspaceName}" |
| Filter tab: all | "All" |
| Filter tab: briefings | "Briefings" |
| Filter tab: ralph | "Ralph" |
| Filter tab: chat | "Chat" |
| Send button | "Send" |
| Composer placeholder | "Message your agent... (Enter to send)" |
| Load more button | "Load older" |
| Load more loading | "Loading..." |
| Empty state heading (no data) | "No reports yet" |
| Empty state body (no data) | "Reports from your agent will appear here once they start sending." |
| Empty state heading (error) | "Unable to reach relay" |
| Empty state body (error) | "Check your relay URL and network connection, then try refreshing." |
| Empty state heading (filtered, no match) | "No {type} found" |
| Empty state body (filtered, no match) | "Try switching to a different filter." |
| Blocker section header | "Blockers" |
| Briefing card title | "Briefing Report" |
| Ralph card title | "Ralph Loop #{N}" |
| Ralph loop id label | "Loop: {first 8 chars}" |
| Ralph what-changed label | "What changed" |
| Ralph cumulative label | "Cumulative" |
| Metrics table headers | "Metric" / "Baseline" / "Current" / "Delta" |
| Chart toggle text | "Show convergence chart" |
| Reply button | "Reply" |
| Reply indicator | "Replying to {reportType} from {relativeTimestamp}" |
| Reply dismiss (aria-label) | "Cancel reply" |
| Sender label: user | "You" |
| Sender label: agent | "Agent" |
| Timestamp relative: <1min | "just now" |
| Timestamp relative: <1hr | "{N}m ago" |
| Timestamp relative: <24hr | "{N}h ago" |
| Timestamp relative: >=24hr | "MMM D, h:mm a" (absolute) |
| Status: connected | "Connected" |
| Status: stale | "Stale" |
| Status: error | "Error" |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none | not required |

No third-party component libraries. All components are custom React + CSS using VSCode CSS variables.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: FLAG (Send/Reply single-word CTAs — contextually clear)
- [x] Dimension 2 Visuals: PASS
- [x] Dimension 3 Color: FLAG (no explicit 60/30/10 split)
- [x] Dimension 4 Typography: PASS (2 weights: 400, 600)
- [x] Dimension 5 Spacing: FLAG (12/20 non-standard but match existing codebase)
- [x] Dimension 6 Registry Safety: PASS

**Approval:** APPROVED (2026-04-21)
