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
