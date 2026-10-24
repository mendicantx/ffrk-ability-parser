# Battle captures

Each `.json` file here is input to the Ability Parser, in any format the parser accepts. Usually it's a full battle capture, trimmed to the actor data (`battle.buddy` / `battle.supporter` with `id`, `params[0].disp_name`, `soul_strikes` and `abilities`). `test/js/parser.golden.test.mjs` renders each one and compares the output with `test/fixtures/golden/parser/<name>.tsv` and `.html`.

| File | Source | Covers |
|---|---|---|
| `ace-2023.json` | Real 2023 battle capture (from the FFRK-js repo) | Ace: Radiant Jackpot Shot (CASB) and its Crystal Force ability; `shouldIgnoreReflection` with `counter_enable: 0` |
| `ace-2023-counter-enabled.json` | `ace-2023.json` with every `counter_enable` set to `"1"` | The Counter column honouring `shouldIgnoreReflection` when counter is otherwise enabled |
