# Interaction Language

## Contents

- Build an interaction hierarchy
- Preserve physical continuity
- Design pointer behavior
- Choreograph scroll and reveals
- Handle sound and media
- Model state explicitly
- Protect accessibility and performance

## Build an interaction hierarchy

Use four levels:

1. **Signature:** one memorable transition or manipulation that expresses the concept.
2. **Structural:** navigation, section entry, state changes, and object continuity.
3. **Local:** hover, focus, press, drag, scrub, toggle, and validation feedback.
4. **Ambient:** subtle loops, grain, light, or background response.

Spend most motion budget on the signature and structural levels. Local effects should be fast and legible. Ambient motion must be optional, quiet, and cheap.

## Preserve physical continuity

When an object changes context, users should perceive one object moving rather than one disappearing and another appearing.

For a shared-object transition:

1. Capture the source bounds.
2. Establish or reveal the destination.
3. Capture the destination bounds after layout settles.
4. Animate a temporary shared representation with transform and opacity.
5. Transfer state to the destination.
6. Remove the temporary representation even if the transition is interrupted.

Provide an immediate state change under reduced motion. Never make animation completion a prerequisite for core functionality.

Avoid losing user activation before starting protected media. Prime or start media work directly from the click when browser policies require it, then coordinate the visual transition.

## Design pointer behavior

Enable pointer-reactive effects only for `(hover: hover) and (pointer: fine)`.

Good uses:

- a bounded highlight over a physical surface;
- one or two degrees of tilt;
- a small magnetic translation on compact controls;
- a subtle background offset;
- a conceptually meaningful custom cursor state.

Rules:

- Normalize and clamp pointer coordinates.
- Smooth toward the target instead of mapping raw movement directly.
- Prefer CSS custom properties plus transforms.
- Reset cleanly on pointer leave.
- Keep interactive hit targets stationary even when their artwork moves.
- Do not hide essential labels behind hover.

Use a custom cursor only when the concept calls for a tool, object, or material indicator. Keep a visible hotspot, clear hover states, and the native cursor on touch, coarse pointers, reduced motion, form fields, or unsupported contexts. Avoid cursor trails and large cursors that obscure content.

## Choreograph scroll and reveals

- Reveal groups or meaningful compositions, not every sentence.
- Use Intersection Observer for one-time entry reveals.
- Keep final content visible without JavaScript.
- Use small stagger offsets only when they clarify order.
- Avoid scroll-jacking, forced progress, and long pinned sequences without informational value.
- Make anchor navigation land on the functional content, not in the middle of a transition.

## Handle sound and media

- Require a clear user action before audible playback.
- Handle the promise returned by media playback and show an honest blocked/error state.
- Keep UI state synchronized with actual media events, not assumptions.
- Model play, pause, seek, mute, track change, end, and visibility changes.
- Stop or suspend work when the page is hidden when appropriate.
- Separate arrival transforms from continuous media animation. For example, let an outer record scale into place while an inner surface owns rotation.
- Give continuous animation an asymmetric cue so motion is perceptible.
- Preserve pause position where the metaphor benefits from it.

## Model state explicitly

Name phases such as:

```text
idle → previewed → selected → transitioning → loaded → playing ↔ paused → ended
```

Keep one owner for each state. Derive classes, labels, disabled states, animation states, and ARIA attributes from that source. Repeated clicks and interrupted transitions must not create duplicate media graphs, orphaned elements, or contradictory controls.

## Protect accessibility and performance

- Provide visible focus states and keyboard-equivalent information.
- Use native buttons, links, sliders, and media semantics when possible.
- Respect `prefers-reduced-motion` in CSS and JavaScript.
- Keep state changes understandable when transforms and transitions are disabled.
- Avoid continuous layout reads and writes in the same frame.
- Use requestAnimationFrame for continuous pointer work and stop offscreen work when practical.
- Prefer transform and opacity; animate layout properties only for small, intentional effects.
- Test CPU slowdown, fast repeated actions, tab visibility changes, touch assumptions, and 200% zoom.
