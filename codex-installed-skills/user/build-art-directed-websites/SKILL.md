---
name: build-art-directed-websites
description: Design, implement, redesign, and visually QA distinctive art-directed websites whose concept, typography, composition, motion, sound, and interactions form one coherent experience. Use for artist and music sites, portfolios, campaign microsites, product launches, editorial stories, experimental landing pages, immersive single-page sites, or requests for bold, premium, cinematic, playful, tactile, custom-cursor, or highly interactive frontend work in HTML/CSS/JavaScript, React, Next.js, or an existing web repository.
---

# Build Art-Directed Websites

Create original websites that feel authored rather than assembled. Let the subject produce the visual system and interaction model; do not paste decorative effects onto a generic page.

## Read the right references

- Read [references/design-thinking.md](references/design-thinking.md) before choosing the concept, visual language, copy voice, or page structure.
- Read [references/interaction-language.md](references/interaction-language.md) before designing custom cursors, hover behavior, scroll choreography, media controls, or shared-object transitions.
- Read [references/implementation-and-qa.md](references/implementation-and-qa.md) before coding and again before final delivery.

## Follow the workflow

### 1. Discover the project truth

- Inspect the repository, framework, routes, component system, assets, content, and existing conventions before editing.
- Identify the subject, audience, emotional aftertaste, decisive user action, required content, real functionality, device expectations, and non-negotiable constraints.
- Separate supplied facts and assets from assumptions. Keep assumptions easy to replace; ask only when a choice would materially change the outcome.
- Preserve the existing stack unless a change is necessary.

### 2. Generate the idea before the interface

- Extract nouns, verbs, materials, rituals, tensions, and sensory cues from the subject.
- Generate at least three concept directions. Express each as a metaphor plus behavior, not a style adjective.
- Choose one visual thesis and one interaction thesis. Example: “A private archive where each work behaves like a physical artifact.”
- Define the one signature moment users should remember. Make supporting effects reinforce it.
- Reject concepts that could fit an unrelated client after changing only the logo and copy.

### 3. Establish a coherent design system

- Choose typography for voice, palette for atmosphere, spacing for rhythm, and geometry for the subject’s material world.
- Define tokens for color, type, spacing, borders, shadows, layers, motion durations, easings, and container widths.
- Build one recurring motif from the concept: a mark, grid, line system, texture, framing device, or physical object.
- Use contrast, scale, cropping, and negative space before adding ornament.
- Create original patterns with CSS, SVG, code, or licensed/user-provided assets. Do not imitate a reference site’s recognizable composition or signature effects.

### 4. Compose an experience, not a stack of sections

- Shape the page as arrival → orientation → exploration → payoff → close.
- Make the hero establish mood and purpose within one viewport.
- Give each major section one visual idea and a clear hierarchy.
- Prefer a few memorable compositions over repeated cards and interchangeable feature grids.
- Treat mobile as a separate composition using the same concept, not a collapsed desktop layout.

### 5. Design the interaction grammar

- Give motion a job: explain cause, preserve object identity, reveal state, direct attention, or provide delight.
- Build one signature transition, then use restrained microinteractions for hover, focus, press, selection, loading, playing, paused, and disabled states.
- Keep related elements physically consistent. If an object travels between views, preserve its perceived identity through the transition.
- Make pointer effects local and bounded. Use a custom cursor only when it advances the concept and remains obviously usable.
- Keep essential information and actions available without hover or animation.
- Honor reduced motion and coarse pointers in both CSS and JavaScript.

### 6. Implement from the behavior inward

- Use semantic HTML, native controls, logical headings, descriptive labels, visible focus states, and keyboard-complete behavior.
- Model phase-based behavior explicitly, such as `idle → selected → transitioning → playing → paused`.
- Separate content data, interaction state, rendering, and side effects such as media playback.
- Use transforms and opacity for most animation. Avoid layout-thrashing pointer loops and unbounded work.
- Handle media permission failures, missing assets, touch input, interrupted transitions, and repeated actions safely.
- Keep the page meaningful when JavaScript, hover, sound, or motion is unavailable.

### 7. Verify the experience

- Run relevant formatting, lint, typecheck, tests, and production build commands.
- Inspect the site in a real browser at mobile, tablet, laptop, and wide desktop sizes.
- Exercise every state: keyboard, pointer, touch assumptions, reduced motion, media success/failure, navigation, and repeated interactions.
- Check console errors, overflow, clipping, focus visibility, contrast, animation continuity, performance, and text wrapping.
- Capture representative screenshots and iterate until every viewport feels intentionally composed.

## Enforce the quality bar

- The concept must be explainable in one sentence and visible without explanation.
- The signature interaction must emerge from the subject rather than from trend-chasing.
- Every effect must support hierarchy, meaning, state, or physical continuity.
- Controls must work, not merely resemble controls.
- Accessibility and reduced-motion behavior are part of the art direction.
- Remove generic residue: arbitrary gradients, excessive pills, stock glow, cursor trails, ornamental dashboards, repetitive cards, and animations applied uniformly to everything.
- Finish only when the site remains distinctive, usable, responsive, and coherent with motion disabled.
