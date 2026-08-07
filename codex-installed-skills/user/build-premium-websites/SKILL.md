---
name: build-premium-websites
description: Design, implement, redesign, or audit premium responsive marketing and product websites with the visual restraint, typography, spatial rhythm, cinematic storytelling, polished navigation, motion, and finish associated with top-tier technology brands. Use for landing pages, product launches, company sites, feature pages, campaign microsites, and high-fidelity frontend builds in HTML/CSS/JavaScript, React, Next.js, or an existing web stack, especially when the user asks for Apple-like, minimal, luxurious, editorial, cinematic, or highly polished design. Do not use to reproduce a protected site pixel-for-pixel or copy proprietary brand assets.
---

# Build Premium Websites

Create original premium websites with disciplined art direction and production-ready implementation. Treat “like Apple” as a quality bar—clarity, restraint, typography, imagery, rhythm, and motion—not as permission to clone Apple’s trade dress, copy, assets, or exact layouts.

## Required workflow

1. Inspect the repository, framework, routes, design tokens, existing components, assets, and build commands before changing code.
2. Establish the page’s audience, single primary conversion, content hierarchy, required sections, available brand assets, and technical constraints. Infer low-risk details when absent and state consequential assumptions.
3. Choose one visual thesis in a sentence, such as “precision hardware in a warm editorial world.” Use it to decide type, color, imagery, geometry, and motion.
4. Define tokens before composing sections: fonts, type scale, widths, spacing, colors, radii, borders, shadows, and motion. Read [references/visual-system.md](references/visual-system.md) and follow it unless an existing brand system overrides it.
5. Build the information arc and select section patterns. Read [references/page-patterns.md](references/page-patterns.md).
6. Implement semantic, accessible, responsive components using the project’s existing stack. Do not replace working infrastructure merely to match a preferred framework.
7. Add motion only after the static composition works. Read [references/motion-responsive.md](references/motion-responsive.md).
8. Verify behavior and appearance at representative phone, tablet, laptop, and wide-desktop sizes. Read [references/engineering-qa.md](references/engineering-qa.md).
9. Iterate on visible defects. Do not call the page complete after only a compile or unit-test pass.

## Non-negotiable quality rules

- Preserve one dominant message and one primary action per viewport.
- Use no more than two font families and three font weights unless the brand system requires more.
- Use authentic product, editorial, or generated imagery with a consistent art direction. Never invent URLs to nonexistent assets.
- Prefer one strong hero composition over a collage of effects.
- Keep navigation visually quiet, legible, keyboard accessible, and usable without hover.
- Use generous negative space, but reduce it deliberately on small screens.
- Make every decorative choice repeat as a system. Avoid isolated gradients, glows, pills, radii, and shadows.
- Avoid generic “AI startup” styling: excessive purple gradients, glass cards everywhere, floating blobs, tiny gray text, and uniformly rounded containers.
- Avoid wall-to-wall cards. Use type, whitespace, rules, imagery, and background shifts to establish hierarchy.
- Avoid oversized headings that wrap into awkward one-word lines or displace the product below the fold without purpose.
- Write concise, concrete copy. Replace “revolutionize,” “seamless,” and “next-generation” with a specific capability or result.
- Maintain WCAG-aware contrast, visible focus states, semantic landmarks, logical headings, reduced-motion support, and usable touch targets.
- Never copy Apple’s logo, product imagery, marketing text, custom typefaces, exact page composition, or distinctive trade dress.

## Default design direction

Apply these defaults only when no brand system exists:

- Use a neutral sans-serif system stack: `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- For an editorial tone, pair it with one licensed or locally available serif for display text; otherwise stay with one sans family.
- Use near-black `#1D1D1F`, off-white `#F5F5F7`, white `#FFFFFF`, secondary gray `#6E6E73`, and one brand accent selected for the subject.
- Set body text to 17px/1.55 on desktop and 16px/1.5 on mobile; keep primary reading lines near 60–72 characters.
- Use a 44px desktop navigation and a 48–56px mobile header. Use a translucent surface only where underlying content makes the effect meaningful.
- Use a 12-column desktop grid, 8-column tablet grid, and 4-column mobile grid with centered content and fluid gutters.
- Use an 8px spacing base with a restrained set of semantic spacing tokens.
- Default to 12–20px radii for grouped surfaces; use pills only for compact controls, badges, and actions that warrant them.
- Prefer opacity and transform animation lasting 180–700ms. Never make essential reading depend on scroll choreography.

## Adapt to the job

- If a repository has brand tokens or a component library, preserve and refine them rather than overlaying a second design system.
- If the user supplies a reference site, extract general principles and relationships. Produce an original composition and identify any asset or font that requires a license.
- If the task is only design, provide an implementation-ready specification: tokens, grid, component states, breakpoint behavior, and motion rules.
- If the task includes implementation, create complete working states rather than static mockup shells. Include loading, empty, error, focus, and menu states where relevant.
- If a page depends on imagery that is unavailable, use an intentional local placeholder strategy or create/request assets. Do not hide missing art behind gradients.

## Deliverable standard

Hand off:

- A working responsive page in the requested stack.
- A concise summary of the visual thesis and major design decisions.
- A list of new or changed files.
- Verification results, including viewport sizes inspected and commands run.
- Any unresolved asset, licensing, content, performance, or browser caveats.

