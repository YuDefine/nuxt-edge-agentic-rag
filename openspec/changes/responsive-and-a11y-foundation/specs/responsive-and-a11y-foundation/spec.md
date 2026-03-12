## ADDED Requirements

### Requirement: Baseline Supported Viewport Width

The system SHALL declare `360px` as the baseline minimum supported viewport width. User interfaces SHALL render without horizontal overflow at any viewport width `>= 360px`. The system SHALL NOT implement defensive hacks (horizontal scroll wrappers, zoom-out viewports, runtime width detection) to support `< 360px`; behavior below 360px is considered out of scope.

#### Scenario: Interface renders at 360px without overflow

- **WHEN** a page is rendered at viewport width exactly 360px
- **THEN** no horizontal scrollbar appears on the body element
- **AND** all primary interactive elements (buttons, inputs, nav triggers) are reachable without horizontal scrolling

#### Scenario: Interface at 320px is out of scope

- **WHEN** a page is rendered at viewport width 320px (below baseline)
- **THEN** the system does not attempt special compensation
- **AND** content may overflow; such behavior is not treated as a bug

### Requirement: Breakpoint Token Tiers

The system SHALL define six breakpoint tiers corresponding to Tailwind 4 theme tokens. The baseline `xs` token SHALL be added to the Tailwind theme configuration with value `360px`. The `sm`, `md`, `lg`, `xl` tokens SHALL match Tailwind 4 defaults (`640px`, `768px`, `1024px`, `1280px`). The application SHALL NOT introduce custom breakpoint values beyond the `xs` addition.

#### Scenario: Tailwind theme exposes xs breakpoint

- **WHEN** the Tailwind 4 build compiles the application's CSS
- **THEN** the `xs:` utility prefix resolves to `min-width: 360px`
- **AND** the `sm:`, `md:`, `lg:`, `xl:` prefixes retain Tailwind 4 default values

#### Scenario: Developer applies xs-prefixed utility

- **WHEN** a component uses `class="xs:px-4 md:px-8"`
- **THEN** the rendered styles apply `px-4` from `360px` up to `767px` and `px-8` from `768px` upward

### Requirement: Mobile-First Layout Pattern At md Breakpoint

The system SHALL use `md` (768px) as the pivot between mobile-layout and tablet-plus-layout patterns. Above or equal to `md`, layouts SHALL render a persistent sidebar; below `md`, the sidebar SHALL be hidden and replaced with a drawer (`USlideover` or equivalent) triggered by a visible menu button in the header.

#### Scenario: Layout shows persistent sidebar at md or wider

- **WHEN** a page is rendered at viewport width `>= 768px`
- **THEN** the primary navigation sidebar is visible and occupies a fixed width on the left edge
- **AND** no menu button is shown in the header

#### Scenario: Layout uses drawer pattern below md

- **WHEN** a page is rendered at viewport width `< 768px`
- **THEN** the sidebar is not rendered inline
- **AND** a menu button is visible in the header
- **AND** activating the menu button opens a drawer overlay containing the navigation entries

#### Scenario: Chat conversation history follows the same pattern

- **WHEN** the chat layout is rendered at viewport width `< 768px`
- **THEN** the conversation history panel is not rendered inline
- **AND** is accessible through a drawer triggered from the chat header

### Requirement: Hybrid Table Fallback Below md

Data tables SHALL use a hybrid fallback pattern below `md`. At `md` or wider, the full `UTable` with all columns SHALL be displayed. Below `md`, the table SHALL present a reduced row showing only primary columns (identifier, status indicator, and a single primary action) with an explicit "detail" action that opens a drawer showing the remaining columns. The system SHALL NOT substitute a pure card-per-row view and SHALL NOT rely on horizontal scrolling as the sole fallback below `md`.

#### Scenario: Table renders full columns at md or wider

- **WHEN** a data table is rendered at viewport width `>= 768px`
- **THEN** all columns declared for the table are visible in the row
- **AND** no detail drawer action is rendered inline

#### Scenario: Table reduces to primary columns below md

- **WHEN** a data table is rendered at viewport width `< 768px`
- **THEN** only the identifier column, status column, and one primary action are shown per row
- **AND** each row exposes a detail action (such as a chevron or "Open" button) that opens a drawer

#### Scenario: Detail drawer surfaces hidden columns

- **WHEN** a user activates the detail action on a table row below `md`
- **THEN** a drawer opens showing all columns that are hidden in the reduced row, including any actions menu
- **AND** closing the drawer returns focus to the triggering detail action

### Requirement: nuxt-a11y Module Dev-Time Integration

The system SHALL integrate the `nuxt-a11y` module into Nuxt configuration so it is active during local development (`NODE_ENV !== 'production'`). The module SHALL NOT be shipped in production builds. The integration SHALL surface `nuxt-a11y` warnings in the developer console and in the Nuxt devtools panel during development.

#### Scenario: nuxt-a11y loaded in development build

- **WHEN** the application is started with `pnpm dev`
- **THEN** the Nuxt module list includes `nuxt-a11y`
- **AND** known a11y issues (missing alt text, insufficient contrast, focus trap errors) appear in console or devtools

#### Scenario: nuxt-a11y excluded from production build

- **WHEN** the application is built with `pnpm build`
- **THEN** the final Workers bundle does not include `nuxt-a11y` runtime code
- **AND** the production bundle size delta attributable to `nuxt-a11y` is zero

### Requirement: WCAG AA Contrast For Tailwind Theme Tokens

The Tailwind theme SHALL define color tokens whose combinations used in the application satisfy WCAG 2.1 AA contrast minimums: `>= 4.5:1` for body text and small text against the token used for its background, `>= 3:1` for large text (18pt or 14pt bold) and for non-text UI components (button boundary, icon, focus ring). Token pairs that fail to meet these minimums SHALL NOT be used for foreground-on-background combinations in interactive contexts.

#### Scenario: Body text token satisfies 4.5:1 ratio

- **WHEN** body text is rendered using the declared body foreground token against the declared background token
- **THEN** the contrast ratio is at least 4.5:1

#### Scenario: Primary button satisfies 4.5:1 ratio

- **WHEN** a primary button label is rendered using the declared primary foreground token against the primary background token
- **THEN** the contrast ratio is at least 4.5:1

#### Scenario: Focus ring satisfies 3:1 ratio

- **WHEN** an interactive element receives keyboard focus and displays a focus ring
- **THEN** the focus ring color against the adjacent background is at least 3:1

### Requirement: Keyboard Navigation Completeness

All interactive elements (buttons, links, inputs, selects, menu items, drawer triggers, modal controls) SHALL be reachable via Tab key navigation. All modal dialogs, drawers, and popover menus SHALL trap keyboard focus while open and SHALL close when the Escape key is pressed. Focus SHALL return to the triggering control when a dialog, drawer, or popover closes. Every interactive element SHALL display a visible focus indicator when focused via keyboard (`focus-visible` state).

#### Scenario: All interactive elements reachable via Tab

- **WHEN** a user presses Tab repeatedly starting from the top of a page
- **THEN** every interactive element on the page receives focus in DOM order
- **AND** no interactive element is skipped

#### Scenario: Modal traps focus while open

- **WHEN** a modal dialog is open and the user presses Tab from the last focusable element inside the modal
- **THEN** focus cycles to the first focusable element inside the modal
- **AND** focus does not escape to elements behind the modal

#### Scenario: Escape closes modal and restores focus

- **WHEN** a modal dialog is open and the user presses Escape
- **THEN** the modal closes
- **AND** keyboard focus returns to the control that opened the modal

#### Scenario: Focus ring visible on keyboard focus

- **WHEN** an interactive element receives focus via Tab navigation
- **THEN** a visible focus ring is rendered around the element
- **AND** the focus ring is not suppressed by mouse-click focus

### Requirement: Skip-To-Main Navigation Link

Every page SHALL include a "skip to main content" link as the first focusable element in the DOM. This link SHALL be visually hidden until focused via Tab and SHALL become visible when focused. Activating the link SHALL move keyboard focus to the main content landmark, bypassing the navigation.

#### Scenario: Skip link appears on Tab focus

- **WHEN** a user presses Tab from a freshly loaded page
- **THEN** the "skip to main content" link receives focus
- **AND** the link becomes visually visible (not in `sr-only` state)

#### Scenario: Skip link moves focus to main

- **WHEN** the skip link is focused and the user presses Enter
- **THEN** focus moves to the main content landmark
- **AND** subsequent Tab presses navigate from within the main content rather than the navigation

### Requirement: Design Review Responsive And Accessibility Steps

The repository's Design Review workflow SHALL include a responsive breakpoint check and an accessibility check as distinct steps. The responsive check SHALL verify the affected surfaces render correctly at `xs` (360), `md` (768), and `xl` (1280) viewports. The accessibility check SHALL verify the `nuxt-a11y` dev report shows no error-severity findings and that keyboard-only navigation can complete the documented user journeys. These steps SHALL be encoded in `.spectra.yaml` `design.review_steps` and referenced in the Design Review Task Template of `.claude/rules/proactive-skills.md` so new change proposals automatically inherit them.

#### Scenario: Spectra config declares responsive and a11y steps

- **WHEN** `.spectra.yaml` is loaded by the Spectra runtime
- **THEN** `design.review_steps` contains a `responsive_check` entry and an `a11y_check` entry
- **AND** both entries appear after `targeted_skills` and before `audit`

#### Scenario: Proactive-skills rule template references both steps

- **WHEN** a developer reviews `.claude/rules/proactive-skills.md` Design Review Task Template
- **THEN** the template includes a "響應式檢查" task item referencing xs / md / xl viewports
- **AND** the template includes a "無障礙檢查" task item referencing `nuxt-a11y` and keyboard walkthrough

#### Scenario: New change proposals inherit the extended template

- **WHEN** a developer creates a new change with Design Review and populates tasks from the proactive-skills template
- **THEN** the generated Design Review task group contains responsive and a11y checks without manual addition
