---
title: Why Grid Lines Broke My Tailwind Setup
date: 2025-10-31
excerpt: Exploring Washington Post's grid design, discovering why Tailwind can't handle internal grid borders, and building pure CSS alternatives
---

# Why Grid Lines Broke My Tailwind Setup

I was scrolling through the Washington Post website the other day and got obsessed with their grid design. You know the one those elegant lines running through the grid that separate content while maintaining visual flow. Clean. Minimal. Beautiful.

This was something I wanted to apply to my own website so I tired building my own verison.

I figured I'd just add that to a project. Probably just a few Tailwind classes.

I was wrong.

## The Tailwind Problem

The issue with Tailwind is architectural. The technique for creating internal grid borders (those lines between grid cells) requires:

1. **Coordinated pseudo-element styling** you need `::before` and `::after` working together
2. **CSS variables for positioning** - calculated offsets that change based on grid gaps
3. **Structural CSS thinking** - multiple utilities operating in tandem, not atomically

Tailwind's utility-first approach breaks down here. You can't compose "add a vertical line" + "add a horizontal line" + "position them right" into a clean utility stack. It's too relational, too contextual.

The problem isn't Tailwind's fault. It's just not designed for this kind of structural layout challenge. Utilities work great for padding, colors, typography. But grid line architecture? That's a job for handwritten CSS.

## Finding the Solution

Then I found [geary.co's article on internal borders in CSS Grid](https://geary.co/internal-borders-css-grid/). 

Use pseudo-elements positioned absolutely in the grid gaps. Set `overflow: hidden` on the grid container. Done. No complex selectors. No messy workarounds. Just clever CSS.

The technique uses:
- `::before` for vertical lines
- `::after` for horizontal lines
- CSS variables for gap calculations
- `overflow: hidden` to hide edge lines automatically


## Building My Own Variations

Following the article, I built two variations:

### inner-grid

**[View on GitHub](https://github.com/alantothe/inner-grid)** - Full-viewport spanning lines between grid items. The lines extend edge-to-edge, creating a bold visual grid effect.

![inner-grid demo](https://github.com/alantothe/inner-grid/raw/main/screenshot.png)

### inner-grid-v2

**[View on GitHub](https://github.com/alantothe/inner-grid-v2)** - Same concept but with horizontal line breaks. Less aggressive visually, but still maintains that clean separated-cell aesthetic.

![inner-grid-v2 demo](https://github.com/alantothe/inner-grid-v2/raw/main/screenshot.png)


## The Lesson

Sometimes the simplest solution requires understanding the primitives. Tailwind is great for rapid prototyping and consistent styling. But when you need structural design, when layout and visual hierarchy are intertwined, you need CSS that thinks in terms of relationships, not utilities.

The grid line problem taught me that good design often lives in the space where framework conventions don't quite reach. That's not a limitation. That's where the interesting work happens.

Now when I see clean grid designs, I don't immediately think "how do I Tailwind this?" I think "what CSS primitive would make this elegant?"

It's a small shift. But it changes everything.
