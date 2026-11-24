---
status: accepted
---

# Patch the core with an opt-in RWKV review queue

Hayaki for desktop adopts the decision in [Android ADR-0009](https://github.com/amemiya02/Hayaki/blob/main/docs/adr/0009-opt-in-rwkv-scheduling.md). A switch in the Scheduling settings lets the learner queue review Cards by an RWKV model's predicted recall instead of by their stored due dates. With the switch off, the app schedules exactly as upstream Anki does.

`vendor/anki` moves from upstream Anki at tag `26.09.4` to a Hayaki fork of that tag. The fork changes how review Cards are gathered and counted, links Fushi's `fushi_rwkv` inference crate, and adds a small Hayaki service with `RwkvStatus` and `PrepareRwkv`. `src-tauri/codegen` reads the fork's descriptor set, so the new service gets typed calls like every other method. Android and iOS build from the same fork.

## Consequences

- [ADR 0001](0001-tauri-shell-around-unmodified-anki-core.md) says scheduling is upstream's code. That no longer holds for the review queue. Sync, search, storage and import and export stay upstream's code.
- Desktop is the first app to ship the switch, because a full replay is fastest there and the patch can be tested without a phone. The [specification](https://github.com/amemiya02/Hayaki/blob/main/.scratch/rwkv-scheduling/spec.md) lists the tests that gate it.
- Each core upgrade rebases the patch onto the new upstream tag, then regenerates the calls.
- The app uses the same small model as Android and iOS and downloads its weights when the learner first turns the switch on. The terms for those weights are recorded in the Android decision.
