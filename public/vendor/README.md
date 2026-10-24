# Vendored scripts

Loaded only inside the battle.js Web Worker (`app/javascript/ffrk/battle_runtime.js`), never by the pages themselves.

| File | Source | SHA-512 (matches cdnjs SRI) |
|---|---|---|
| `underscore-umd-1.13.7.min.js` | https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.13.7/underscore-umd-min.js | `sha512-dvWGkLATSdw5qWb2qozZBRKJ80Omy2YN/aF3wTUVC5+D1eqbA+TjWpPpoj8vorK5xGLMa2ZqIeWCpDZP/+pQGQ==` |

battle.js was built against underscore 1.x; the Worker gives it this copy as `_` and the `underscore` AMD module.
