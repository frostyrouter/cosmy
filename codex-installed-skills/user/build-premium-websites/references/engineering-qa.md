# Engineering and visual QA

## Contents

1. Implementation rules
2. Accessibility
3. Performance
4. SEO and metadata
5. Visual inspection
6. Completion checklist

## 1. Implementation rules

- Use the existing framework, package manager, formatting, linting, and component conventions.
- Centralize reusable design tokens in the project’s established token layer or CSS custom properties.
- Keep components aligned to stable visual or behavioral responsibilities; avoid a component per wrapper.
- Use semantic HTML before ARIA and native interactions before custom abstractions.
- Use CSS for layout and visual states; use JavaScript for actual behavior.
- Avoid dependencies for effects that can be implemented reliably in a small amount of existing-stack code.
- Do not add a new icon, animation, or CSS framework when the project already has one.
- Preserve server rendering and progressive enhancement where the framework supports them.
- Never put secrets, analytics keys, or private endpoints in client code.

## 2. Accessibility

Verify:

- One descriptive `h1`; subsequent headings follow a logical hierarchy.
- Landmarks include header, nav, main, and footer where applicable.
- Skip link appears on focus and targets the main content.
- All controls are keyboard reachable, visibly focused, named, and operable.
- Focus is not obscured by sticky UI.
- Text and interactive contrast meet WCAG AA targets; large display type is not an excuse for weak body contrast.
- Informative images have contextual alt text; decorative images are ignored.
- Form fields have persistent labels, instructions, and associated errors.
- Menus, dialogs, tabs, and disclosures follow established ARIA patterns.
- Content remains usable at 200% zoom and with larger text.
- Motion respects `prefers-reduced-motion`.

## 3. Performance

Treat visual polish and speed as the same requirement:

- Set explicit media dimensions to avoid cumulative layout shift.
- Optimize hero media and avoid shipping desktop-size assets to phones.
- Subset and self-host licensed fonts when appropriate; use `font-display: swap` or `optional` based on brand tolerance.
- Limit font families, weights, and character sets.
- Lazy-load below-fold media and defer noncritical scripts.
- Keep above-fold DOM and CSS uncomplicated.
- Avoid autoplay video on constrained data connections; provide a poster and controls.
- Profile rather than assume. Pay particular attention to LCP, CLS, INP, total JavaScript, and long animation frames.
- Ensure effects degrade on older devices and during low-power operation.

## 4. SEO and metadata

- Set a unique title and description matching the page’s actual promise.
- Provide canonical and social metadata when the project supports them.
- Use descriptive link text, crawlable navigation, and real headings rather than styled divs.
- Add structured data only when content legitimately matches a schema.
- Supply a deliberate social preview asset rather than relying on a random screenshot.

## 5. Visual inspection

Run the project and inspect rendered output, not source code alone. Capture or view representative sizes and evaluate:

- First-view hierarchy: can a new visitor identify product, value, and next action in five seconds?
- Typography: do wraps, line lengths, weights, and optical alignment look deliberate?
- Rhythm: are chapter boundaries clear without every section receiving a new decoration?
- Navigation: does it remain legible over every underlying state and work by keyboard/touch?
- Media: are crops intentional and free of stretching, pixelation, and layout shift?
- Responsive behavior: is there overflow, clipping, overlap, accidental microtext, or excessive empty space?
- Interaction: are hover, focus, active, loading, open, closed, and error states coherent?
- Motion: does it stay smooth, reversible, and subordinate to content?
- Authenticity: is any content, logo, metric, quote, or product screen fabricated?

When browser automation is available, check console errors and take screenshots at the target sizes. When it is not, state that visual verification remains outstanding.

## 6. Completion checklist

Before handoff:

- Build succeeds.
- Relevant lint and tests pass, or failures are explained.
- No broken local asset references or invented remote URLs remain.
- No unexpected horizontal overflow exists at 320px and above.
- Mobile navigation opens, closes, restores focus, and supports Escape where relevant.
- All primary controls have hover, focus-visible, active, and disabled states where relevant.
- Reduced-motion behavior works.
- Images have dimensions, suitable loading strategy, and correct alt behavior.
- Text contrast and focus visibility have been checked.
- Key pages have title, description, and social metadata where applicable.
- Screens have been visually inspected at phone, tablet, laptop, desktop, and breakpoint-adjacent widths.
- The result is original and does not reproduce protected brand assets or exact reference-site composition.

