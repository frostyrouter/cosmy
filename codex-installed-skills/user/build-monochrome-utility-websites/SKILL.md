---
name: build-monochrome-utility-websites
description: Design, implement, redesign, and visually QA premium utility and SaaS websites with a crisp black-and-white visual system, generous editorial spacing, product-led storytelling, and refined pointer, hover, scroll, and state transitions. Use for Zoom-like meeting tools, collaboration products, productivity utilities, AI tools, dashboards with marketing surfaces, conversion-focused SaaS landing pages, or requests for an Apple-inspired, Listen Labs-inspired, minimalist, monochrome, highly polished web experience in HTML/CSS/JavaScript, React, Next.js, or an existing frontend repository.
---

# Build Monochrome Utility Websites

Build original product websites that feel calm, precise, and tactile. Translate the restraint and product clarity associated with Apple and the editorial, demonstration-led energy associated with Listen Labs into a distinct design; never reproduce either company's layout, copy, logo, proprietary typeface, imagery, or signature assets.

## Read the right references

- Read [references/design-language.md](references/design-language.md) before choosing typography, spacing, color, layout, imagery, or components.
- Read [references/utility-storytelling.md](references/utility-storytelling.md) when shaping a meeting, collaboration, productivity, AI, or workflow product page.
- Read [references/motion-and-qa.md](references/motion-and-qa.md) before adding animation and again before final verification.

## Follow the workflow

### 1. Establish the product truth

- Inspect the existing repository, framework, component system, routes, and available assets before editing.
- Identify the primary utility, audience, decisive user action, and shortest path to first value.
- Determine the target segment, commercial model, guest versus authenticated flow, supported devices and browsers, required integrations, validated trust claims, and whether the marketing demo must be functional or explicitly simulated. Use clearly marked assumptions when these are unknown and easy to revise; ask only when the choice would materially change the product or implementation.
- Write a one-sentence value proposition that states the outcome, not a vague category claim.
- Define one primary CTA and at most one secondary CTA per section.
- Preserve the user's stack and conventions unless a change is necessary to meet the request.

### 2. Choose a coherent visual thesis

- Default to a warm-white or white canvas, near-black text, quiet grays, black primary actions, hairline borders, and subtle depth.
- Use one accent color only when product state, brand identity, or comprehension needs it; do not add an accent merely for decoration.
- Favor a strong typographic hierarchy, broad negative space, asymmetric editorial composition, and a prominent live-looking product surface.
- Keep the result recognizably original. Combine principles, not page structures.
- Write a short design thesis before coding, for example: “A quiet command center where the meeting itself is the hero.” Use it to reject unrelated effects.

### 3. Design the page around the utility

- Make the hero communicate the outcome within one viewport using a direct headline, brief proof-oriented copy, CTA pair, and a product demonstration.
- Show the tool working through real UI states, not generic decorative cards. Use credible labels and sample content appropriate to the product.
- Build a narrative sequence: promise → proof → how it works → capabilities → use cases → trust → final action.
- Prefer a few large, memorable compositions over a dense grid of interchangeable cards.
- For Zoom-like products, make presence, connection, control, and reliability visible through meeting rooms, participants, transcripts, scheduling, or collaboration states.
- Keep navigation compact and obvious. Put deep product detail below the fold.

### 4. Implement a real visual system

- Define CSS custom properties or equivalent tokens for color, type, spacing, radii, borders, shadows, motion, and container widths.
- Use a legally available system or open-source sans-serif stack. Do not bundle or imply access to SF Pro or another proprietary font.
- Use fluid type and spacing with `clamp()`; avoid scaling desktop dimensions uniformly onto mobile.
- Use semantic HTML, native controls, visible focus states, descriptive labels, logical heading order, and keyboard-complete interactions.
- Keep component APIs small. Extract repeated visual primitives without abstracting one-off compositions prematurely.
- Use real icons from the project's established icon library when available. Avoid emoji and mismatched icon styles.

### 5. Add motion as feedback and choreography

- Implement interaction states for every clickable element: rest, hover, focus-visible, active, disabled when relevant, and loading/success/error for product controls.
- Use transform and opacity for most motion. Reserve blur, filters, parallax, and spring effects for one or two hero moments.
- Make pointer-responsive motion subtle and local. Do not replace the native cursor by default, trail the cursor, or let content chase the pointer.
- Give keyboard focus the same information as hover. Never hide essential content behind hover.
- Honor `prefers-reduced-motion: reduce`; remove nonessential movement and preserve state changes without animation.
- Avoid scroll-jacking, forced smooth scrolling, autoplay audio, and perpetual decorative motion.

### 6. Verify the experience, not just the build

- Run the repository's relevant lint, typecheck, test, and production build commands.
- Inspect the rendered page in a real browser at narrow mobile, tablet, laptop, and wide desktop widths.
- Exercise navigation, CTAs, menus, dialogs, form states, keyboard traversal, pointer hover, touch behavior, and reduced-motion behavior.
- Check the browser console, layout overflow, text wrapping, media cropping, sticky elements, focus visibility, and contrast.
- Capture screenshots at representative breakpoints and compare hierarchy, density, and polish. Fix the page and repeat until it looks intentional at every width.
- Confirm all product claims, links, and interactions are accurate; do not ship fake controls unless clearly presented as a noninteractive marketing mockup.

## Enforce the quality bar

- Make the product, not decoration, the visual centerpiece.
- Use white space to separate ideas, not to compensate for weak hierarchy.
- Keep body copy readable and line lengths controlled; do not use display type for long paragraphs.
- Prefer one excellent reveal sequence over many unrelated animations.
- Ensure mobile compositions are redesigned, not merely stacked.
- Remove template residue: repetitive icon cards, arbitrary gradients, excessive pills, stock “AI” glow, generic star fields, and decorative dashboards with no product meaning.
- Finish only when the primary flow is clear, the page is responsive and accessible, motion is calm, and the implementation is production-ready.
