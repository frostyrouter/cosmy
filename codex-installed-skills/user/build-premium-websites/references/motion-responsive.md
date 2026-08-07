# Motion, interaction, and responsive behavior

## Contents

1. Motion principles
2. Timing system
3. Entrance and scroll effects
4. Navigation interaction
5. Responsive composition
6. Touch and pointer input
7. Reduced motion

## 1. Motion principles

Use motion to explain continuity, hierarchy, state, or causality. Remove motion that merely proves animation is possible. Ensure the page remains understandable and operable when all motion is disabled.

Order motion priority:

1. Immediate response to input.
2. State transition and continuity.
3. Orientation during navigation.
4. Guided attention.
5. Atmosphere.

## 2. Timing system

Define reusable tokens:

```css
--duration-fast: 160ms;
--duration-base: 240ms;
--duration-slow: 480ms;
--duration-cinematic: 700ms;
--ease-out: cubic-bezier(.16, 1, .3, 1);
--ease-standard: cubic-bezier(.2, .8, .2, 1);
--ease-in-out: cubic-bezier(.65, 0, .35, 1);
```

- Hover/press: 120–220ms.
- Menus, accordions, and local state: 180–320ms.
- Section reveals: 400–700ms.
- Large cinematic transitions: up to 900ms only when the user is not waiting for control.
- Stagger repeated items by 40–90ms and cap the overall sequence near 500ms.
- Animate opacity and transforms. Avoid layout-triggering properties when possible.

## 3. Entrance and scroll effects

- Default reveal: opacity 0→1 and translateY 12–24px→0.
- Trigger once when 15–30% of the element enters the viewport.
- Keep headings and their supporting text temporally grouped.
- Never hide SEO-critical or readable content permanently if JavaScript fails.
- Avoid animating every paragraph, icon, and divider.
- Use sticky sections only after testing keyboard navigation, small-height laptops, mobile browser chrome, and reduced motion.
- Clamp scroll progress, avoid frame-by-frame React state updates, and prefer requestAnimationFrame or established motion libraries already in the project.

## 4. Navigation interaction

- Maintain a consistent focus order between desktop and mobile variants.
- Make header surface transitions reversible and free from jumps.
- If the header hides on downward scroll, reveal it immediately on upward scroll or keyboard focus.
- Do not hide the header when a menu is open.
- Animate menu opacity and small translation; avoid dramatic full-page rotations or scale effects.
- Ensure anchor jumps account for sticky-header height using `scroll-margin-top`.

## 5. Responsive composition

Design behavior, not screenshots. Add breakpoints when content requires them; typical starting points are 480, 768, 1024, and 1280px.

- Mobile: preserve the thesis, priority, and focal asset; reduce decoration and choreography.
- Tablet: treat as its own composition when a split hero becomes cramped.
- Desktop: use available width to improve relationship and scale, not simply to enlarge everything.
- Wide desktop: cap reading and control widths; allow backgrounds and media to extend.
- Short viewport: prevent sticky scenes or oversized heroes from trapping content below controls.
- Navigation: collapse before links wrap or collide, not at an arbitrary device label.
- Grid: reorder only when reading and focus order remain logical.
- Type: use fluid scales but set bounds so translated or user-scaled text does not explode the layout.
- Media: choose breakpoint-specific crops and safe subject positions.
- Tables: reformat or scroll with clear affordances; never shrink below legibility.

Test at minimum:

- 360×800 and 390×844 phone.
- 768×1024 tablet.
- 1280×800 compact laptop.
- 1440×900 desktop.
- One width between each declared breakpoint.

## 6. Touch and pointer input

- Keep interactive targets at least 44×44 CSS pixels where possible.
- Do not require hover to reveal essential content or actions.
- Apply hover styles inside `@media (hover: hover)` when they could stick on touch devices.
- Support keyboard activation for every custom interactive element; prefer native elements.
- Avoid horizontal gesture conflicts with browser navigation.

## 7. Reduced motion

Implement a global reduction path:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

Then replace important animated explanations with their final static state. Do not rely exclusively on the global snippet if a canvas, video, WebGL scene, or JavaScript animation continues independently.

