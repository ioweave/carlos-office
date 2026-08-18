---
name: Technical Ocean
colors:
  surface: '#fbf8ff'
  surface-dim: '#d7d8f0'
  surface-bright: '#fbf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f2ff'
  surface-container: '#edecff'
  surface-container-high: '#e6e6fe'
  surface-container-highest: '#e0e1f8'
  on-surface: '#181a2b'
  on-surface-variant: '#424655'
  inverse-surface: '#2d2f41'
  inverse-on-surface: '#f0efff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0050e2'
  primary: '#004edd'
  on-primary: '#ffffff'
  primary-container: '#2c68ff'
  on-primary-container: '#fffbff'
  inverse-primary: '#b5c4ff'
  secondary: '#575e74'
  on-secondary: '#ffffff'
  secondary-container: '#d9dff9'
  on-secondary-container: '#5b6278'
  tertiary: '#006859'
  on-tertiary: '#ffffff'
  tertiary-container: '#008471'
  on-tertiary-container: '#f4fffa'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b5c4ff'
  on-primary-fixed: '#00164e'
  on-primary-fixed-variant: '#003cae'
  secondary-fixed: '#dbe2fc'
  secondary-fixed-dim: '#bfc6e0'
  on-secondary-fixed: '#141b2e'
  on-secondary-fixed-variant: '#3f465b'
  tertiary-fixed: '#59fbdd'
  tertiary-fixed-dim: '#2ddec1'
  on-tertiary-fixed: '#00201a'
  on-tertiary-fixed-variant: '#005145'
  background: '#fbf8ff'
  on-background: '#181a2b'
  surface-variant: '#e0e1f8'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 26px
    fontWeight: '600'
    lineHeight: '1.2'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-max: 1280px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is rooted in technical precision and oceanic tranquility. It serves a professional environment that demands clarity, focus, and a sense of calm reliability. The aesthetic avoids the "loud" trends of modern marketing UI, instead opting for a disciplined, systematic approach that feels like a well-engineered instrument.

The design style is **Modern Corporate with a Minimalist/Technical edge**. It prioritizes high-quality typography, thin linework, and ample whitespace. Interaction models are grounded and predictable, favoring thin 1px borders and subtle tonal shifts over heavy shadows or complex gradients. The emotional response should be one of "quiet confidence"—efficient, organized, and deep.

## Colors

The color palette is built on a foundation of "Cool Neutrals" and "Technical Blues," now enhanced with a vibrant "Cyan Accent" for specialized data visualization.

- **Foundation:** The background utilizes a crisp, very light blue-tinted grey to reduce eye strain compared to pure white, while keeping the interface feeling "oceanic."
- **Surfaces:** Surfaces use pure white (#FFFFFF) for primary content areas to ensure maximum contrast, while `surface-container` tiers provide a subtle layer for secondary navigation or utility bars.
- **Accents:** The **Primary Blue (#2163FF)** is the core driver for critical actions and active states, offering a more saturated, high-performance feel.
- **Tertiary Highlight:** The **Teal/Cyan (#40E9CC)** is introduced as a high-visibility accent, ideal for success states, specialized data points, or "active" oceanic elements.
- **Deep Ocean:** The darkest shade (**#10172A**) is strictly reserved for the Office Map and complex data visualizations to provide a high-contrast, technical backdrop that mimics a blueprint or a deep-sea sonar display.

## Typography

This design system uses a dual-font strategy to balance character with utility. **Hanken Grotesk** is used for headlines to provide a sharp, contemporary, and engineered feel. **Inter** is the primary body typeface, selected for its exceptional readability and neutral "workhorse" qualities in dense technical interfaces.

- **Hierarchy:** Use tight line-heights for headlines to maintain a "compact" technical feel. 
- **Labels:** **JetBrains Mono** is introduced for small labels, status indicators, and data points to reinforce the "technical" and "precise" brand pillars.
- **Readability:** Body text (Inter) should maintain a generous line-height (1.5x - 1.6x) to ensure long-form technical data remains digestible.
- **Mobile:** Scale large headings down for mobile to avoid awkward line breaks, ensuring the UI remains "compact" across all viewports.

## Layout & Spacing

The layout philosophy centers on an **Open Grid** model. Rather than nesting content inside multiple containers or cards, we use thin 1px dividers and strategic whitespace to group information.

- **Grid:** A 12-column fluid grid is used for desktop, collapsing to 4 columns on mobile.
- **Dividers:** Use neutral `outline-variant` for horizontal and vertical rules. Dividers should be the primary method of separation. 
- **Rhythm:** All spacing is based on a 4px baseline. Use `16px` (md) as the standard padding for most components.
- **Mobile Adaptivity:** Component padding remains consistent across breakpoints to maintain brand identity, but horizontal margins increase from `16px` on mobile to `32px` on desktop to allow the layout to breathe.

## Elevation & Depth

Elevation is conveyed through **Tonal Layering** and **Low-Contrast Outlines** rather than traditional shadows. 

- **Primary Layer:** The background is the light `surface` shade.
- **Secondary Layer:** Active surfaces or focused areas use `surface-container-lowest` (#FFFFFF) with a 1px border.
- **Shadows:** Avoid drop shadows for standard UI elements. A very subtle, neutral "ambient" shadow may be used only for floating elements like dropdown menus or tooltips to separate them from the grid.
- **Interactive Depth:** On hover, instead of lifting an element, change the background color to a subtle container shift or darken the border color.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a subtle nod to approachability while maintaining the structured, technical "squareness" of the layout.

- **Standard Elements:** Buttons, input fields, and checkboxes use a `4px` (0.25rem) radius.
- **Large Elements:** Map overlays or sidebars use `8px` (0.5rem) to feel more integrated into the larger layout frame.
- **Status Pills:** Status indicators and chips may use `rounded-xl` (0.75rem) to differentiate them from functional buttons.

## Components

- **Buttons:** Solid **Primary Blue (#2163FF)** for main actions. Secondary buttons use a white background with a 1px neutral border. Use `label-sm` (Inter) for button text.
- **Input Fields:** 1px neutral border, white background. On focus, the border changes to Primary Blue with no outer glow.
- **Lists:** Use 1px horizontal dividers between items. Avoid row backgrounds unless hovered.
- **Cards:** Do not use cards for everything. Only use them when content must be draggable or floating. Otherwise, use a simple 1px border-bottom to define sections.
- **Office Map:** Use the **Deep Ocean palette (#10172A base)**. Active paths or specialized equipment should use the **Teal accent (#40E9CC)** for high-visibility contrast. Use high-contrast white text for room labels.
- **Chips:** Small, 12px Inter text, neutral `surface-variant` background, and no border. Used for metadata and filtering.
- **Checkboxes:** Square with 2px radius. When checked, use Primary Blue with a white checkmark.