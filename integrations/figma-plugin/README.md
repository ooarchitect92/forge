# Forge SiteDocument Figma Plugin

This development plugin is the governed structural write surface for Forge -> Figma.

## Flow

1. In Forge, call the SiteDocument endpoint `POST /api/websites/:id/site-document/figma/plugin/export` or use the control-center export action.
2. Paste the returned JSON into this plugin.
3. Choose **Merge** to update nodes carrying Forge identities, or **Replace** to replace only Forge-managed children.
4. Review the changes in Figma before publishing the design library.

The plugin does not receive OAuth tokens, customer secrets, CMS integration credentials, or publishing configuration. Its payload contains design structure only: pages, elements, reusable components, style data and design tokens.

## Identity and conflict behavior

- Page roots use `forgePageId`.
- Element nodes use `forgeId`.
- Reusable component definitions use `forgeComponentDefinitionId`.
- Imported objects store the originating Forge revision.
- Merge mode never deletes unrelated Figma nodes.
- Replace mode deletes children only inside the selected Forge-owned page/component roots.

The REST integration remains the preferred path for Variables synchronization and inbound file changes. This plugin exists because arbitrary canvas mutation belongs in Figma's Plugin API rather than an invented generic REST node-write endpoint.
