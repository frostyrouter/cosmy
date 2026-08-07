# Premium visual system

## Contents

1. Art direction
2. Typography
3. Color
4. Grid and containers
5. Spacing and density
6. Navigation bar
7. Buttons and links
8. Surfaces and cards
9. Imagery and media
10. Icons
11. Forms

## 1. Art direction

Choose three adjectives that can be judged visually, such as “precise, calm, luminous.” Reject vague adjectives such as “modern.” Make each choice support the same thesis:

- Typography establishes voice.
- Space establishes confidence.
- Color establishes emphasis.
- Imagery establishes emotion and proof.
- Motion establishes continuity.

Use a restraint budget: one accent hue, one display device, one signature motion motif, and one surprising composition per page. Do not make every section compete.

## 2. Typography

### Font selection

Use fonts already shipped by the project first. Verify license and actual font files before declaring `@font-face`.

Use this fallback matrix when the user supplies no font:

| Intent | Primary | Optional display | Notes |
|---|---|---|---|
| Product precision | Inter or system UI | None | Safest default; neutral and crisp |
| Editorial luxury | Inter or system UI | Instrument Serif, Newsreader, or another licensed serif | Limit serif to hero/display text |
| Technical utility | IBM Plex Sans or system UI | IBM Plex Mono | Use mono only for data or labels |
| Friendly consumer | Manrope or system UI | None | Use moderate weight, not bubbly decoration |

Never claim to use San Francisco/SF Pro unless the project is legally entitled to ship it. The CSS system stack may resolve to the platform UI font on Apple devices; that is acceptable.

### Default scale

Use fluid type with `clamp()` and tune wrapping at real widths:

```css
--text-xs: clamp(.75rem, .72rem + .10vw, .8125rem);
--text-sm: clamp(.875rem, .84rem + .12vw, .9375rem);
--text-body: clamp(1rem, .96rem + .18vw, 1.0625rem);
--text-lead: clamp(1.125rem, 1.02rem + .42vw, 1.375rem);
--text-h3: clamp(1.5rem, 1.25rem + .9vw, 2rem);
--text-h2: clamp(2rem, 1.45rem + 2vw, 3.5rem);
--text-h1: clamp(2.75rem, 1.65rem + 4.2vw, 6.5rem);
```

- Set display line-height to .92–1.05 and body line-height to 1.45–1.65.
- Use `letter-spacing: -0.02em` to `-0.045em` only on large sans-serif headings.
- Use normal or slightly positive tracking on uppercase labels.
- Keep body copy at 45–75 characters per line; target 60–68.
- Use 600–700 for compact headings, 500–600 for controls, and 400–450 for body when supported.
- Use `text-wrap: balance` for headings and `text-wrap: pretty` for prose as progressive enhancement.
- Prevent widows and single-word final lines when practical, but do not hard-code `<br>` tags unless the composition truly requires a stable editorial break.

## 3. Color

Define semantic tokens, not section-specific hex values:

```css
--color-bg: #f5f5f7;
--color-surface: #ffffff;
--color-ink: #1d1d1f;
--color-muted: #6e6e73;
--color-rule: color-mix(in srgb, var(--color-ink) 14%, transparent);
--color-accent: #0071e3;
--color-accent-hover: #0077ed;
--color-focus: #0066cc;
```

- Select one accent related to the product or brand; verify text contrast in every use.
- Use near-black instead of pure black for large light surfaces; use true black when a cinematic dark scene needs it.
- Restrict gradients to lighting, material, or depth. Do not use gradients as arbitrary decoration.
- Alternate background tone only to mark a meaningful chapter change.
- Never encode state with color alone.

## 4. Grid and containers

Use a fluid centered layout:

```css
--gutter: clamp(1rem, 3vw, 2.5rem);
--content-wide: 90rem;
--content-standard: 75rem;
--content-reading: 45rem;
```

- Desktop: 12 columns, 20–32px gaps, maximum width 1200–1440px.
- Tablet: 8 columns, 20–24px gaps.
- Mobile: 4 columns, 16px gutters and 12–16px gaps.
- Let full-bleed media escape containers deliberately; align its internal subject with the content grid.
- Use optical alignment for rounded or diagonal shapes when mathematical alignment looks wrong.
- Avoid centering every section. Mix centered hero moments with left-aligned explanatory chapters.

## 5. Spacing and density

Start with an 8px system and semantic tokens:

```css
--space-1: .25rem;
--space-2: .5rem;
--space-3: .75rem;
--space-4: 1rem;
--space-6: 1.5rem;
--space-8: 2rem;
--space-12: 3rem;
--space-16: 4rem;
--space-24: 6rem;
--space-32: 8rem;
```

- Use 96–160px desktop section padding for major chapters; reduce to 64–96px on mobile.
- Keep eyebrow-to-heading distance smaller than heading-to-body distance.
- Keep a component’s internal padding consistent across repeated instances.
- Increase space at conceptual boundaries, not merely after every element.
- Avoid both cramped “dashboard density” and empty expanses that convey no rhythm.

## 6. Navigation bar

Build a restrained header with explicit states:

- Desktop height: 44–52px for a global marketing nav, or 64–72px when the brand mark requires it.
- Mobile height: 48–56px, with a menu trigger at least 44×44px.
- Position: static by default; sticky only when persistent navigation improves the journey.
- Surface: transparent over a clean hero; transition to `rgba(255,255,255,.78)` plus `backdrop-filter: saturate(180%) blur(18px)` after scroll only when content underneath remains readable.
- Fallback: provide an opaque background when backdrop filtering is unsupported.
- Layout: brand left, primary links centered or adjacent, high-priority action right. Keep the action compact.
- Typography: 12–14px, medium weight, high contrast, no uppercase unless required by the brand.
- Active state: use weight, tone, or a small indicator; never rely on hover alone.
- Divider: use a 1px low-contrast rule only after the header gains a surface.
- Mobile menu: use a real button with `aria-expanded` and `aria-controls`; trap focus only for a modal/full-screen drawer; close on Escape; restore focus; lock background scroll safely.
- Avoid a translucent nav over busy high-contrast imagery unless a gradient scrim guarantees legibility.

## 7. Buttons and links

- Primary button: 44–52px high, 16–24px horizontal padding, 500–600 weight, radius 999px only if pills belong to the system; otherwise 10–14px.
- Secondary action: text link with arrow or restrained outline, not another equally loud filled button.
- Keep labels concrete: “Explore the camera,” “Start a trial,” “See pricing.”
- Provide hover, active, focus-visible, disabled, and loading states.
- Animate color and transform over 160–220ms; keep press displacement within 1–2px.
- Do not place more than two adjacent calls to action in a hero.

## 8. Surfaces and cards

- Use cards only when content items are siblings or independently actionable.
- Default radius: 12–20px. Reserve 24–32px for large image-led modules.
- Prefer a subtle border or a subtle shadow, not both at maximum strength.
- Use `box-shadow: 0 12px 40px rgba(0,0,0,.08)` as an upper starting point for floating surfaces; reduce it in most cases.
- Maintain consistent image aspect ratios within repeated card rows.
- Never nest more than two visibly styled surfaces.

## 9. Imagery and media

- Lead with one high-resolution focal asset whose subject remains legible at mobile crops.
- Use `object-position` per breakpoint when the subject moves under crop.
- Provide explicit width/height or `aspect-ratio` to prevent layout shift.
- Use AVIF/WebP where supported, sensible `srcset`/`sizes`, and lazy loading below the fold.
- Do not lazy-load the largest contentful hero image; preload only when measurement justifies it.
- Add a dark/light scrim only to achieve stable text contrast; keep it subordinate to the image.
- Use device frames sparingly and match perspective, lighting, and shadow across scenes.
- Provide useful alt text for informative media and empty alt text for decoration.

## 10. Icons

- Use one coherent icon family or custom SVG language.
- Default to 20–24px icons with 1.5–2px stroke for controls.
- Align icons optically with labels and preserve a 44px interactive hit area.
- Do not use emoji as interface icons.
- Hide decorative SVGs from assistive technology; label icon-only buttons.

## 11. Forms

- Keep labels visible; placeholders are examples, not labels.
- Use 44–52px control height, 16px minimum mobile input text, clear focus rings, and inline error association.
- Group related inputs, explain constraints before submission, and preserve entered data after validation errors.
- Keep marketing forms short; ask only for information required at the current step.

