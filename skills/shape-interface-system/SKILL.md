---
name: shape-interface-system
description: Design or audit a cohesive product interface system across hierarchy, components, interaction patterns, tokens, responsive behavior, and accessibility. Use for UI refactors, design-system work, component selection, interaction-heavy screens, or high-fidelity interface direction; do not use before the underlying flow and information structure are sufficiently defined.
---

# Outcome

Produce an implementable interface direction with consistent components, states, tokens, responsive rules, and accessible semantics.

# Workflow

1. Inspect the existing product, design system, component library, and target flows.
2. Identify the smallest set of baseline objects, pages, and states that expose the system's visual needs.
3. Define hierarchy through typography, spacing, grouping, contrast, density, and progressive disclosure.
4. Reuse proven accessible primitives before designing custom controls.
5. Map each interaction to a recognizable component and expected keyboard behavior.
6. Specify default, hover, focus, active, selected, disabled, loading, error, and destructive states where applicable.
7. Define token roles rather than page-specific values.
8. Test responsive reflow, zoom, text expansion, touch targets, contrast, and reduced motion.
9. Remove decoration, containers, labels, and effects that do not clarify hierarchy or state.
10. Provide Finn with component behavior and acceptance criteria, not only images.

# Decision rules

- Choose custom components only when established primitives cannot express the required behavior.
- Prefer semantic HTML and platform behavior over simulated controls.
- Treat aesthetic references as directional evidence, not permission to copy.
- Ask Echo to review language and Sentry to verify critical interactions.

# Verification

Check component consistency, token coverage, focus order and visibility, keyboard operation, contrast, responsive behavior, error recovery, and parity between design intent and implementation notes. Copy `templates/work/interface-direction.md`.

# Resources

For ORCA-to-UI mapping, object cards, component foundations, or interaction decisions, choose the relevant method from [`references/design-dash/index.md`](references/design-dash/index.md).
