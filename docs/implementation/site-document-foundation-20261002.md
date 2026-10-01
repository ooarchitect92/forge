# SiteDocument foundation — 2026-10-02

This branch starts the canonical SiteDocument work without replacing the current editor persistence path.

## Implemented in this slice

- Added a strict, versioned SiteDocument contract covering site metadata, pages, reusable components, styles, design tokens, assets, CMS collection definitions/bindings, interactions, forms, locales, experiments and integrations.
- Added referential-integrity validation for CMS bindings and uniqueness checks for canonical identifiers.
- Added a first typed command batch with `element.insert`, `element.delete`, `element.updateProperties`, `token.set`, `token.delete`, and `style.updateRule`.
- Command application is immutable, target-checked, bounded, and re-validates the complete SiteDocument after the batch.
- Added focused Node tests for canonical validation, immutable command application, and missing-target rejection.

## Compatibility rule

The existing `Website.editorData` format remains untouched in this commit. The new canonical contract is additive so current sites and publishing flows cannot be broken by an automatic migration.

## Next implementation steps

1. Add a compatibility adapter from current CanonicalWebsiteData/editorData into SiteDocument v1.
2. Persist SiteDocument schema version and revision metadata behind a feature flag.
3. Route editor mutations through typed commands while retaining the current save endpoint as a compatibility path.
4. Add CMS collection/binding commands and resolver integration with existing CustomPostType data.
5. Add Figma/Stitch import adapters that produce command batches rather than direct document writes.
