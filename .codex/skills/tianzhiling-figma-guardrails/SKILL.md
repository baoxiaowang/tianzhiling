---
name: tianzhiling-figma-guardrails
description: Project-specific rules for implementing Figma designs in TianZhiLing. Use for any Figma-to-code task in this repo, especially mobile screens, tabs, detail pages, and component work. Enforces what parts of a Figma frame should be implemented and what should be ignored.
---

# TianZhiLing Figma Guardrails

Apply these rules whenever implementing or updating UI from Figma in this repo.

## Core rule

Implement the app UI only.

Do not implement device chrome or mockup framing that appears around the real screen content.

## Ignore these Figma elements unless the user explicitly asks for them

- Phone outer frame, rounded device shell, shadows from the mockup
- OS status bar content such as time, signal, carrier, Wi-Fi, battery
- iPhone or Android home indicator, gesture bar, system navigation bar
- Screenshot-only artifacts used to present the screen in Figma

Use Flutter `SafeArea` and the app's own layout instead of recreating those elements manually.

## What to implement

- The actual page content inside the app screen
- App-owned navigation bars, tab bars, search bars, cards, forms, lists, badges, dialogs
- Icons and controls that belong to the product UI rather than the device OS

## When a Figma frame mixes both

If a node contains both app UI and device chrome:

1. Visually identify the first app-owned container
2. Start implementation from that container downward
3. Preserve spacing relationships inside the app UI
4. Drop spacing that only exists because of the mock status bar or device shell

## For this repo specifically

- Prefer implementing mobile pages inside a centered constrained width layout only when the existing page already does that
- Match the repo's current Flutter patterns and components before introducing custom drawing
- Keep sample or demo data simple and local unless the task asks for API wiring

## Before finishing a Figma task

Check these explicitly:

- No fake battery, time, signal, or carrier UI was added
- No phone shell, home indicator, or system nav bar was added
- The remaining page still matches the intended app content from Figma
