# Battle captures

Each `.json` file here is input to the Ability Parser, in any format the parser accepts. Usually it's a full battle capture, trimmed to the actor data (`battle.buddy` / `battle.supporter` with `id`, `params[0].disp_name`, `soul_strikes` and `abilities`). `test/js/parser.golden.test.mjs` renders each one and compares the output with `test/fixtures/golden/parser/<name>.tsv` and `.html`.

| File | Source | Covers |
|---|---|---|
| `ace-2023.json` | Real 2023 battle capture (from the FFRK-js repo) | Ace: Radiant Jackpot Shot (CASB) and its Crystal Force ability; `shouldIgnoreReflection` with `counter_enable: 0` |
| `ace-2023-counter-enabled.json` | `ace-2023.json` with every `counter_enable` set to `"1"` | The Counter column honouring `shouldIgnoreReflection` when counter is otherwise enabled |
| `seymour-xsb.txt` | Pasted by the owner (mixed `{sb}` + `abilities:[...]` format) | Seymour's XSB: Extra abilities (Anima's Pain, Cursed Requiem), Ability Crash, type-18 attach with `maxLv: 5`, XSB tier |
| `wol-buster.txt` | Pasted by the owner (mixed format); `additional_animation_infos` and `choren_effects` removed, everything else as pasted | Warrior of Light's Buster (Break Glint / Break Arte), `buster_shingi_abilities`, the Destruction chase follow-up, IF/ELSE use-count branches |
| `garland-tasb.txt` | Pasted by the owner (mixed format); `additional_animation_infos` removed, everything else as pasted | Garland's Tactical (TASB): mode row and "(Weapon Skill)" row, TP MAX follow-up, ATB follow-ups, an IF/ELSE party condition |
