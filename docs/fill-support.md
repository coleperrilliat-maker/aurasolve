# Fill Answer audit — 1.16.0

This is a control-compatibility release, not a claim of 100% answer accuracy or support for every Pearson question. Fill never clicks Check answer. Independent model agreement remains an error screen, not a proof of correctness.

## Changes

- Native and custom dropdowns share exact option-value validation. A displayed label is accepted only when it identifies one enabled option.
- Dojo widgets can be found through the loaded AMD registry or the global registry. Numeric option IDs keep their original type when written.
- ARIA dropdowns use an explicitly linked menu, or a unique popup newly opened by their own trigger. Delayed and remounted menus are supported. Unrelated menus are not searched for matching text.
- Readonly display inputs are distinguished from disabled answers. Nested dropdown wrappers and backing selects count as one field.
- Native multi-select controls and ARIA radio/checkbox controls are supported. Multiple radio groups remain separate.
- Proof-table fields include row text and column headers. Every lazy editor is prepared, including mixed questions that already contain a native input.
- Every detected required field must be covered before writing. Known unmapped controls prevent partial fills. Retained values are checked after change handlers settle.
- Independent solutions compare the properties actually executed: a radio target, a graph point's coordinates, or a drag destination. Unused radio wording no longer creates false disagreement.
- A viewport screenshot is supplemented with up to three labeled, rendered diagram close-ups. Small or clipped SVG/image/canvas figures are prioritized. There are no extra model calls for close-ups; image tokens can increase. Individual images and the total payload are bounded. Origin-protected images fall back to the overview.

## What is verified

| Family | Evidence | Limit |
| --- | --- | --- |
| Text and lazy Pearson-style editors | Node checks and real Chrome DOM fixtures | Live installed Pearson integration still needs confirmation |
| Native single/multiple selects | Chrome retains exact selections; disabled groups excluded | Custom multi-select widgets are not covered |
| ARIA custom dropdowns | Linked, delayed, remounted, readonly, nested and backing-select fixtures | A menu must expose readable options and confirm the selected value |
| Dojo dropdowns | AMD-only registry fixture retains numeric zero | Fixture implements documented APIs; not a live Pearson widget |
| Proof tables | Two independent dropdown rows filled with stable question fingerprints | Mathematical proof accuracy was not benchmarked |
| Radio/checkbox controls | Native and ARIA state validation | Canvas-only choice hit regions need a site adapter |
| Graph/image questions | Viewport vision payload and labeled SVG close-ups tested | This verifies reading, not general graph drawing |
| Point plotting / dragging | Existing explicit demo adapters remain | Those adapters are not Pearson's proprietary grapher or drag controls |

**Unfinished: direct Pearson graph drawing.** The current point adapter targets the included practice lab's explicit grid metadata. It does not implement Pearson's line, parabola, circle, shading, endpoint, or graph-save tools. A screenshot can help solve the mathematics but cannot establish that the graph tool recorded the answer. Shipping guessed canvas clicks would not fix this.

## Live test blocker

On 2026-10-15, the available course page opened its ungraded homework review list. Opening a question returned Pearson's Login Error page stating that the account did not have a subscription to that site. No live question control was accessible in that session, and no real assignment answer was submitted. This does not diagnose the user's subscription; it records the observed access failure. The next required validation is a working, signed-in dropdown/proof question and graph-drawing question in the actual player.

## Research

Public sources were reviewed for integration patterns. No competitor code was copied and no authenticated competitor endpoint was accessed.

- [AskLabby](https://www.asklabby.com/): public product/accuracy claims do not establish a usable graph-control API or an independent accuracy benchmark. The earlier local archive audit is in [asklabby-comparison.md](asklabby-comparison.md).
- [Pearson MyLab graph tools](https://help.pearsoncmg.com/xl/student/player/player_all/Content/use_grapher.htm): graph answers involve a palette of distinct tools and a save step.
- [Pearson Mastering graph questions](https://help.pearsoncmg.com/mastering/student/standalone/TopicsStudent/answering_problems_with_graphs.htm): this is a different interface with its own keyboard and attributes controls; one generic click sequence cannot be assumed to cover both products.
- [Dojo registry](https://dojotoolkit.org/reference-guide/1.10/dijit/registry.html) and [select controls](https://dojotoolkit.org/documentation/tutorials/1.10/selects/): retrieve the actual widget and distinguish its option value from displayed text.
- [browser-use tools on GitHub](https://github.com/browser-use/browser-use/blob/main/browser_use/tools/service.py): reviewed native-select handling, waiting for autocomplete menus, value mismatch reporting and screenshot-to-viewport coordinate conversion. General browser automation still needs state observation and action verification; screenshots alone do not solve control semantics.

## Reproduce

Run `npm test` and `npm run check`. Start `node scripts/browser-test-server.js`, then open `http://127.0.0.1:4320/tests/fill-scenarios.html` and click **Run Fill checks**. This runs the actual content detector, action executor and MAIN-world editor bridge against simulated site widgets. Chrome messaging and mathematical answers are fixtures. The existing `/tests/browser-scenarios.html` checks disabled Pearson editor history and the prior multi-part flow.
