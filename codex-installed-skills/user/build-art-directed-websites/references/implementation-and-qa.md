# Implementation and Visual QA

## Contents

- Map the repository
- Build the system
- Implement safely
- Verify behavior
- Review visual quality
- Finish cleanly

## Map the repository

Before editing, inspect:

- framework, package manager, scripts, routes, and build system;
- local instructions and established component patterns;
- fonts, icons, media, imagery, and licenses;
- current responsive rules and accessibility conventions;
- dirty worktree state and unrelated user changes.

Use the existing stack and smallest durable file structure. Keep concept-specific visuals local rather than forcing them into a generic component library.

## Build the system

Define tokens before styling individual sections:

```css
:root {
  --ink: #0b0b0b;
  --paper: #f5f3ee;
  --line: color-mix(in srgb, currentColor 18%, transparent);
  --gutter: clamp(1rem, 4vw, 4.5rem);
  --ease-out: cubic-bezier(.22, 1, .36, 1);
  --duration-fast: 160ms;
  --duration-base: 280ms;
  --duration-slow: 650ms;
}
```

Tune tokens to the concept. Do not default every project to monochrome, rounded cards, or the example values.

Use fluid typography and spacing with `clamp()`. Cap readable text widths. Establish consistent gutters, vertical rhythm, focus rings, borders, layers, and animation durations.

## Implement safely

- Preserve semantic document order even when the visual layout is asymmetric.
- Keep content data separate from DOM orchestration.
- Validate indexes, URLs, asset availability, and media support at boundaries.
- Prefer small behavior modules for independent concepts such as playback or pointer effects.
- Clean up observers, animation frames, audio nodes, cloned transition objects, and event listeners when lifecycles require it.
- Do not depend on experimental APIs without feature detection and a complete fallback.
- Do not autoplay audible media.
- Avoid false functionality. If a control is shown, make it work or label the surface as a visual prototype.

## Verify behavior

Run the repository’s formatter, lint, typecheck, targeted tests, and production build where available.

Use a real browser and test this minimum matrix:

| View | Width | Check |
| --- | ---: | --- |
| Narrow mobile | 360–390px | wrapping, gutters, tap targets, overflow, composition |
| Large mobile | 430px | navigation, object scale, control fit |
| Tablet | 768–1024px | in-between grids, sticky behavior, awkward whitespace |
| Laptop | 1280–1440px | first fold, hierarchy, interaction scale |
| Wide desktop | 1600px+ | line length, excessive empty edges, stretched art |

Exercise:

- every link, button, slider, menu, and media control;
- pointer enter, move, leave, press, and rapid repeat;
- keyboard traversal, Enter, Space, Escape, and arrow behavior where relevant;
- touch/coarse-pointer fallbacks;
- reduced motion;
- loading, empty, selected, playing, paused, disabled, success, and error states;
- browser back/forward and anchor navigation when relevant;
- hidden-tab and interrupted-animation behavior.

Inspect console errors and warnings. Confirm there is no horizontal overflow, clipped focus ring, invisible text, layout shift, broken media promise, or interaction that depends on a hover-only secret.

## Review visual quality

Capture screenshots at representative widths after fonts and assets settle. Ask:

1. What does the eye see first?
2. Is the concept visible in the first viewport?
3. Does each section have one dominant idea?
4. Does the interaction explain or embody anything?
5. Is the signature moment given enough space?
6. Does mobile feel art-directed rather than stacked?
7. Is any effect competing with content or controls?
8. Can one element be removed?

Verify motion by measuring actual state when necessary. For rotation, transition, or pause bugs, compare computed transforms or animation states at two points in time rather than trusting a still screenshot.

## Finish cleanly

- Remove placeholder copy, dead controls, debugging output, unused effects, and abandoned experiments.
- Keep factual claims and links accurate.
- Document only the customization or run instructions the repository genuinely needs.
- State any missing real assets, browser limitations, or unverified integrations at handoff.
- Do not declare completion until the primary interaction works at desktop and mobile widths with a clean console.
