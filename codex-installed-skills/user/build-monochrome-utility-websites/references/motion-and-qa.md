# Motion and Visual QA

Use motion to clarify cause, state, hierarchy, and continuity. The page must remain complete with animation disabled.

## Motion system

Define a small shared system:

```css
:root {
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --ease-standard: cubic-bezier(.4, 0, .2, 1);
  --duration-fast: 140ms;
  --duration-base: 240ms;
  --duration-slow: 520ms;
}
```

- Use `120–180ms` for button and icon feedback.
- Use `200–320ms` for menus, tooltips, toggles, and small state changes.
- Use `420–700ms` for large editorial reveals.
- Animate related elements with small `30–70ms` offsets; avoid long cascades.
- Keep hover travel near `1–4px` and pointer-reactive rotation near `0.5–2deg`.
- Prefer `transform` and `opacity`; avoid animating layout properties on large regions.

## Interaction patterns

### Buttons and links

- Shift fill, border, or text tone; add a tiny upward translation only when it suits the physical metaphor.
- Move an arrow or icon independently by `2–4px` to show direction.
- Use `:focus-visible` with a clear outline and offset. Do not remove outlines without replacement.
- Use an active press state with less lift or a slight scale reduction.

### Product surfaces

- Emphasize the active control with a localized glow, ring, or elevation change rather than moving the whole interface.
- Crossfade or slide between believable states when the transition explains a workflow.
- Keep autoplay loops short, quiet, and pausable; stop offscreen work when practical.

### Pointer response

- Use pointer position only for optional local effects such as a faint highlight, tiny card tilt, or spotlight bounded to one hero surface.
- Normalize pointer coordinates, clamp the range, and smooth toward the target instead of mapping raw movement directly.
- Activate only for `(hover: hover) and (pointer: fine)`.
- Reset cleanly on pointer leave and disable entirely under reduced motion.
- Do not use a custom cursor unless the product concept requires it and usability remains obvious.

### Scroll reveals

- Reveal content once as it becomes relevant. Avoid animating every paragraph.
- Use Intersection Observer or the framework's existing motion library.
- Provide the final visible state in server-rendered markup or no-JS fallback.
- Avoid pinned sequences that trap the user or consume multiple viewports without conveying meaningful change.

## Reduced motion

Use an explicit fallback:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Also skip pointer tracking, parallax, autoplay movement, animated blur, and continuous transforms in application code when reduced motion is active.

## Browser QA matrix

Validate at minimum:

| View | Suggested width | Look for |
| --- | ---: | --- |
| Narrow mobile | 360–390px | headline wrap, safe gutters, tap targets, overflow |
| Large mobile | 430px | CTA fit, product crop, navigation behavior |
| Tablet | 768–1024px | awkward in-between grids, sticky behavior |
| Laptop | 1280–1440px | hierarchy, first-fold balance, readable demo scale |
| Wide desktop | 1600px+ | excessive line length, empty edges, stretched imagery |

Test with touch and fine pointer assumptions separately. Confirm that hover-only enhancements disappear gracefully on touch devices.

## Verification checklist

- Confirm no horizontal overflow at any breakpoint.
- Confirm text does not clip at 200% zoom.
- Traverse every interactive element by keyboard.
- Confirm the focus indicator is visible against both light and dark sections.
- Check contrast for text, controls, and meaningful borders.
- Verify menus and dialogs manage focus and Escape correctly.
- Verify loading, empty, error, success, disabled, and selected states where applicable.
- Verify links have real destinations and buttons perform real actions.
- Inspect the browser console for errors and warnings.
- Check image dimensions, modern formats, lazy loading, and stable aspect ratios.
- Confirm animations remain smooth under CPU slowdown and do not cause layout shifts.
- Enable reduced motion and verify the experience still communicates every state.
- Capture screenshots after fonts and images load; compare mobile and desktop for intentional hierarchy.

## Final visual pass

Ask of every section:

1. What is the one idea?
2. What should the eye see first?
3. Does the product prove the copy?
4. Does motion explain anything?
5. Can one element be removed?

Remove effects that do not survive those questions.
