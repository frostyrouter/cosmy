# Design Language

Use this reference to create a premium monochrome system. Treat Apple and Listen Labs as research references, not templates to reproduce.

## Source observations

- Apple's current web and Human Interface Guidelines emphasize hierarchy, harmony, consistency, purposeful motion, predictable controls, and accessibility. Its web typography uses compact navigation, near-black text, carefully limited line lengths, rounded actions, and product imagery as the center of gravity.
- Listen Labs' current homepage uses an editorial white canvas, large regular-weight headlines with tight tracking, asymmetrical hero composition, compact CTAs, a floating product-demo surface, isolated blur/depth, numbered workflow storytelling, and large content shifts rather than dense ornament.
- Derive principles from these observations. Do not copy exact measurements, compositions, animation sequences, branded text, or assets.

Primary sources:

- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
- Apple motion guidance: https://developer.apple.com/design/human-interface-guidelines/motion
- Apple accessibility guidance: https://developer.apple.com/design/human-interface-guidelines/accessibility
- Apple homepage: https://www.apple.com/
- Listen Labs homepage: https://listenlabs.ai/

## Palette

Start with tokens similar to these and tune them for the product:

```css
:root {
  --ink: #0a0a0a;
  --ink-soft: #5f5f63;
  --ink-faint: #8a8a90;
  --paper: #ffffff;
  --paper-warm: #f7f7f5;
  --surface: #f1f1ef;
  --line: rgba(10, 10, 10, 0.11);
  --line-strong: rgba(10, 10, 10, 0.2);
  --shadow-soft: 0 18px 60px rgba(0, 0, 0, 0.09);
}
```

- Keep at least 85% of the visible experience neutral.
- Use opaque surfaces for controls and translucent surfaces only where they clarify layering.
- Use black fields as high-contrast chapters, not as alternating stripes after every section.
- Do not rely on extremely faint gray for important text or borders.

## Typography

- Prefer `Inter`, `Geist`, `Manrope`, or a robust system stack such as `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Use one family unless a second face has a clear editorial role.
- Set display headlines around `clamp(3rem, 7vw, 7.5rem)` for cinematic pages and smaller for dense product pages.
- Use regular or medium display weight, tight but not colliding tracking, and line-height near `0.95–1.05`.
- Set body copy around `clamp(1rem, 1.3vw, 1.25rem)`, line-height `1.45–1.65`, and cap prose near `55–68ch`.
- Use sentence case. Avoid all-caps except for short metadata labels.
- Create contrast through scale and space before introducing more weights.

## Spacing and geometry

- Use a consistent spacing ladder, for example `4, 8, 12, 16, 24, 32, 48, 72, 96, 144`.
- Set page gutters with `clamp(1rem, 4vw, 4.5rem)` and cap primary content around `1280–1440px`.
- Let major sections breathe with `clamp(5rem, 12vw, 11rem)` of block padding.
- Use moderate radii: `10–16px` for controls, `18–32px` for product surfaces, and true pills only for compact controls or tags.
- Use hairline borders and one soft shadow family. Avoid stacking borders, shadows, and glows on every card.

## Composition

- Make the hero feel immediate: a sharp promise on one side or centered, then a product surface with enough scale to read.
- Use controlled asymmetry: offset a product panel, crop one edge, or let a visual span the grid while the copy remains aligned.
- Alternate centered product moments with editorial split sections to create rhythm.
- Use sticky or scroll-linked storytelling only when it explains a sequence and remains usable without motion.
- Let backgrounds stay quiet. Prefer subtle tonal bands, line grids, or controlled soft blur over loud gradients.
- Use one visual motif—such as concentric meeting rings, transcript lines, or participant tiles—and repeat it with restraint.

## Components

- Primary button: near-black fill, white text, comfortable hit area, restrained radius, 1–2px lift or fill change on hover.
- Secondary button: paper or transparent fill, dark border or quiet gray surface, equally strong focus state.
- Navigation: low height, concise labels, persistent primary action only when it helps conversion.
- Product frame: accurate controls, realistic sample data, clear active state, and no meaningless mini-chart clutter.
- Cards: vary scale and purpose. Avoid six identical icon cards when a single comparison, workflow, or product demo would communicate more.
- Social proof: use real customer evidence when supplied; otherwise use neutral placeholders explicitly marked for replacement.

## Originality guardrails

- Do not use Apple or Listen names in the finished product unless the user's content requires factual reference.
- Do not recreate a recognizable Apple product launch hero, Listen Labs' exact floating-question composition, or either site's copy.
- Do not download, trace, or reuse logos, custom illustrations, photography, or proprietary typefaces without user-provided rights.
- Convert inspiration into abstract principles: hierarchy, restraint, product truth, whitespace, tactile feedback, and editorial pacing.
