# [0.8.0](https://github.com/javadtavakoli/trackpilot/compare/v0.6.0...v0.8.0) (2026-06-09)


### Bug Fixes

* declare required field in api.d.ts and tighten shapeSchema test ([864faf0](https://github.com/javadtavakoli/trackpilot/commit/864faf04200362c01ada6ac81d1da2efe279db20))
* preserve explicit empty-string type instead of silently dropping it ([8e42981](https://github.com/javadtavakoli/trackpilot/commit/8e42981ef01f14270971fbc9860b208a8328c4b1))


### Features

* extract shared issue-ops create/update orchestration ([f511bbd](https://github.com/javadtavakoli/trackpilot/commit/f511bbdf15ac8e1223c2fe4f331c8a534ad1767d))
* **mcp:** add release and preview_command tools for full CLI/library parity ([8dfc260](https://github.com/javadtavakoli/trackpilot/commit/8dfc260ea924cd7e3508b5a0490611f0e909197d))
* **mcp:** enrich create_issue/update_issue with fields, type, assignee, tags, links ([0b038ae](https://github.com/javadtavakoli/trackpilot/commit/0b038ae6778026e21ab3f17bc0b13156dbb674c5))
* surface required custom fields in project_schema ([0ede667](https://github.com/javadtavakoli/trackpilot/commit/0ede6672c48e4e5fbe9a04895cd6da4d6778ce2f))
# [0.6.0](https://github.com/javadtavakoli/trackpilot/compare/v0.5.0...v0.6.0) (2026-06-06)


### Bug Fixes

* **mcp:** coerce void tool results to valid string content; harden startup ([2874e26](https://github.com/javadtavakoli/trackpilot/commit/2874e260e8d54fe0f8540f4bc9ee82371dc32983))
* **mcp:** route mcp subcommand errors to stderr, not stdout ([3601cb4](https://github.com/javadtavakoli/trackpilot/commit/3601cb42a6434cc5f5dd015dbef0f46a1363f906))


### Features

* **mcp:** add pure tool registry mapping MCP tools to the API ([3e3b938](https://github.com/javadtavakoli/trackpilot/commit/3e3b938c7ac69171f8ecc9eebcd30146337e45b8))
* **mcp:** add stdio server wiring ([72e18d4](https://github.com/javadtavakoli/trackpilot/commit/72e18d4b7a171964a07ba8e6d0fea73c9c2b4017))
* **mcp:** wire up the \`trackpilot mcp\` subcommand ([2f545fd](https://github.com/javadtavakoli/trackpilot/commit/2f545fdf762b024ea4c565eb7c3dd9bda673f29c))
# [0.5.0](https://github.com/javadtavakoli/trackpilot/compare/v0.4.0...v0.5.0) (2026-06-03)


### Features

* **api:** accept a work-item type reference object in logWorkItem ([ff5e433](https://github.com/javadtavakoli/trackpilot/commit/ff5e43365a0c1c20efe58e497ca8f77991d0a9b6))
# [0.4.0](https://github.com/javadtavakoli/trackpilot/compare/v0.3.0...v0.4.0) (2026-06-03)


### Features

* **api:** support optional work-item type on logWorkItem ([9a45ead](https://github.com/javadtavakoli/trackpilot/commit/9a45ead45339a3c06096e74de50a9132454a12b2))
# [0.3.0](https://github.com/javadtavakoli/trackpilot/compare/v0.2.0...v0.3.0) (2026-06-03)


### Features

* **api:** add logWorkItem() time-tracking primitive ([623e417](https://github.com/javadtavakoli/trackpilot/commit/623e417805552caac97cdfd4460c5dbb9b3ccaef))
* **api:** add me() to read the authenticated user ([0b13c73](https://github.com/javadtavakoli/trackpilot/commit/0b13c73cd5889638348e1c3b5c5a7924b719255d))
* **api:** allow injecting a fetch implementation into createApi ([1644c98](https://github.com/javadtavakoli/trackpilot/commit/1644c980b7f71d914588185e5e5e0b67400d737b))
* **api:** expose low-level request() escape hatch ([ac23abe](https://github.com/javadtavakoli/trackpilot/commit/ac23abeb07e4626e0a1c07577ae782f740c1dae9))
* **api:** publish createApi as a typed library entry point ([6298810](https://github.com/javadtavakoli/trackpilot/commit/6298810e48b06136477b19852bcb44c6e2709676))
# [0.2.0](https://github.com/javadtavakoli/trackpilot/compare/v0.1.0...v0.2.0) (2026-06-02)


### Bug Fixes

* default link id to null for consistency in shapeLinks ([e37284f](https://github.com/javadtavakoli/trackpilot/commit/e37284fe2fc7d9e9a3bc83b432982f5dfcc6270e))
* derive version from conventional commits and publish on push ([2dad600](https://github.com/javadtavakoli/trackpilot/commit/2dad6007d0a6353277de2bae39f1dbf249c43948))
* group field shape, update --type, accurate docs/comment, multi-command test ([2ec86b2](https://github.com/javadtavakoli/trackpilot/commit/2ec86b27ee9149f80d38804e9d4f07e0b9ff46f9))


### Features

* add 'fields <PROJECT>' discovery command; update usage ([1c89e9a](https://github.com/javadtavakoli/trackpilot/commit/1c89e9a89e6f96bf36affd265b7b1e6d9d2ea3bc))
* add apply-fields (resolve, assist pre-flight, grouped apply) ([bbdb4c3](https://github.com/javadtavakoli/trackpilot/commit/bbdb4c323b308a497d492dac7065bdc88417eb83))
* add build-commands (typed flags to YouTrack command list) ([8480392](https://github.com/javadtavakoli/trackpilot/commit/84803929d144deaf01b3b362315d0bc70b17ad73))
* add custom-fields.mjs typed REST payload builder ([58a52fd](https://github.com/javadtavakoli/trackpilot/commit/58a52fdbf66dc1003fba6d0c7dcb8de61e508f96))
* add resolve.mjs value matcher with did-you-mean suggestions ([9b95def](https://github.com/javadtavakoli/trackpilot/commit/9b95defb186bf4071614befe15b5049e81dc5e2e))
* add tags/users/projectSchema/assist/applyCommands to api ([7982ec5](https://github.com/javadtavakoli/trackpilot/commit/7982ec5b1606403ebd4302928b98adc19a2f517d))
* create sets fields/assignee/tags/links in one call with validation ([3a9ee2e](https://github.com/javadtavakoli/trackpilot/commit/3a9ee2e728e2d6765f8a802e7186aeabd0d1ee05))
* support typed customFields in createIssue and add setCustomFields ([914e02d](https://github.com/javadtavakoli/trackpilot/commit/914e02d465d78dbd8ec03536fcb4df36fa3541a7))
* surface tags and links in issue output; export pure shapers ([6111b36](https://github.com/javadtavakoli/trackpilot/commit/6111b3637632930a2388ae69968f44169341e18d))
* update accepts assignee/field/tag/link flags with validation ([3f0f1ed](https://github.com/javadtavakoli/trackpilot/commit/3f0f1ed7a894926f43750757d1147be28024ad5a))
