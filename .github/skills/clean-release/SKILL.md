---
name: clean-release
description: "Use when: a build must start from a clean variant directory, after changing sdkconfig.defaults / CMakeLists / Kconfig / a character manifest, or when an incremental build gives a suspicious result. Wipes exactly one variant build dir, then rebuilds it with scripts/custom_release.py under the machine-wide build lock — never `rm -rf build/`, never a bare `idf.py fullclean`."
argument-hint: "e.g. R300 --options edu-microbit --character pengu"
---

# clean-release

Delete **one variant's** build directory and rebuild it from scratch.

Rebuilt 2026-11-04 from `scripts/custom_release.py` behaviour after the original
`.claude/commands/clean-release.md` (gitignored, local-only) was lost. Every claim below was
re-checked against the script at that date.

## When to use

| Situation | Use this skill |
|---|---|
| You edited `sdkconfig.defaults*`, `main/CMakeLists.txt`, `main/Kconfig.projbuild`, `partitions.csv`, `ci/products.json`, or a `character.json` | ✅ |
| A rebuild produced a byte-identical or suspiciously small binary | ✅ |
| You switched ESP-IDF version | ✅ |
| You only edited `.cc` / `.cppm` / `.h` | ❌ incremental build is enough — run `scripts/custom_release.py` normally |
| The whole `build/` tree is broken | ❌ that is a different, destructive operation — ask the user |

## The one rule

**`build/<variant>/` owns its own `sdkconfig`.** Deleting it is the reset. There is no shared
`sdkconfig` at the repo root and no need for `idf.py fullclean`.

- ✅ `rm -rf build/r300_edu_microbit_pengu`
- ❌ `rm -rf build/` — destroys every variant, including ones another task needs
- ❌ `idf.py fullclean` — leaves `CMakeFiles/` and a stale `sdkconfig` behind, and in the wrong
  directory it cleans the host tree

Run it all under the build lock: other repos share the same IDF 6.1 tree (§Locks).

## Procedure

1. **Find the variant directory name.** It is derived, not typed by hand
   (`scripts/custom_release.py:305` `variant_dir_name`):

   ```
   build/<build_key>_<options>_<character>/   lowercased, separators folded to "_"
   ```

   Examples: `build/r300_edu_microbit_pengu`, `build/r100v3_head_lite_brown`.

   ```bash
   ls -d build/*/ | sed 's|build/||;s|/||'      # what exists right now
   python scripts/custom_release.py --list-boards   # the legal board / preset / character names
   ```

2. **Confirm nothing else is running.** `python3 scripts/lock.py` will queue, but a concurrent
   build in the same directory cannot be fixed by queueing — check first:

   ```bash
   ps -Ao pid,etime,command | grep -E '[i]df\.py|[c]make --build|[n]inja' || echo "no build running"
   ```

3. **Record what you are about to delete** (so the log shows the before/after):

   ```bash
   ls -l build/<variant>/xiaozhi.bin build/<variant>/merged-binary.bin 2>/dev/null
   git -C . rev-parse --short HEAD
   ```

4. **Delete that one directory and rebuild it**, in one locked command:

   ```bash
   python3 scripts/lock.py 'rm -rf build/<variant> && \
     unset IDF_PYTHON_ENV_PATH && \
     source "$HOME/.espressif/tools/activate_idf_v6.1.sh" >/dev/null 2>&1 && \
     export PATH="$IDF_PATH/tools:$IDF_PYTHON_ENV_PATH/bin:$PATH" && \
     /bin/sh -c "idf.py --version" | grep -qE "^ESP-IDF v6\.1" && \
     python scripts/custom_release.py <board> --name <name> [--options <preset>] [--character <char>]'
   ```

5. **Verify from the artifacts, not the log.**

   ```bash
   ls -l build/<variant>/xiaozhi.bin build/<variant>/merged-binary.bin
   ls -l releases/<artifact>_{full,ota}.bin
   strings build/<variant>/xiaozhi.bin | grep -m1 -E '^[0-9a-f]{40}$'   # should be today's HEAD
   ```

   Expect: a fresh `sdkconfig` in the variant dir, `xiaozhi.bin` non-trivial in size, and the
   full SHA inside the binary equal to `git rev-parse HEAD`.

6. **Report** the variant dir, the command, the exit code, artifact sizes, and the SHA found in
   the binary.

## Per-repo notes

| Repo | Entry point | Variant dirs |
|---|---|---|
| CompanionRobots | `python scripts/custom_release.py <board> --name <name> [--options …] [--character …]` | `build/<build_key>_<options>_<character>/` |
| EmotionDisplay | `python3 scripts/custom_release.py --build <character> --fullclean` | `build/<character>/` — the script has its own `--fullclean`, use it instead of `rm -rf` |
| MicroBit | `python3 scripts/custom_release.py` | none — `pxt build` rewrites `built/`; delete `built/` only if a stale hex is suspected |

r300-motor-code is not covered (separate owner; its `dependencies.lock` wants IDF 5.5.3).

## Failure handling

| Symptom | Meaning | Do |
|---|---|---|
| `WRONG IDF` / version gate fails | shell has the wrong `IDF_PYTHON_ENV_PATH` | `unset IDF_PYTHON_ENV_PATH`, re-source, retry once |
| `CMake Error: … requires IDF 6.1` | stale `build/` from 5.x | you are in the right skill — make sure the delete actually happened |
| Build succeeds but `strings` shows an old SHA | binary is stale | the variant dir name was wrong; go back to step 1 |
| `xiaozhi.bin` near the partition size | out of flash headroom | report it, do not mask it (R300-edu-microbit-pengu had 1% free on 2026-11-04) |
