# ComputerCraft Emulator

A browser-based emulator for **ComputerCraft 1.7.10** (CC 1.75 era), with a planned 3D world where you place computers, peripherals and blocks and wire them together. Personal fan project, not distributed.

## Status

**Milestone 3, peripherals** (`milestone-3-peripherals`):

- One simulation Worker runs every computer and peripheral, so peripheral calls are synchronous like CC's computer thread
- **Monitors** and **Advanced Monitors** join into multiblock screens (up to 8x6) with connected textures; `setTextScale`, `monitor_resize`, and `monitor_touch` on Advanced Monitors (right click the screen)
- **Disk Drive**: right click to insert a new or spare floppy, or eject. Disks mount as `disk`, `disk2`, ...; the `disk` API, labels, `disk`/`disk_eject` events, 125 KB per floppy, saved in IndexedDB
- **Wireless Modem**: `open`/`close`/`transmit`, `modem_message` with 1.7.10 range rules (64 blocks, more at height), so `rednet` works between computers
- **Redstone**: levers, redstone blocks and lamps; computers read inputs and drive outputs per side (`rs.setOutput`, `os.pullEvent("redstone")`)
- Adjacent computers show up as `computer` peripherals (`turnOn`, `shutdown`, `reboot`, `getID`)
- **HTTP**: `http.get`/`http.post`/`http.request` use the browser's `fetch`, so only sites that allow cross-origin requests (CORS) work directly. The menu's *HTTP Settings* takes an optional CORS proxy address (`{url}` marks where the encoded address goes)
- Blocks are drawn as merged chunk meshes, and the world redraws slowly while a GUI is open, so typing stays responsive

**Milestone 2, the 3D world** (`milestone-2-world`):

- Creative-mode world in Three.js with Minecraft's face shading, sky and fog
- Fly with WASD, Space and Shift (Ctrl for speed); mouse look via pointer lock, or drag-to-look where pointer lock isn't available
- Left click breaks, right click places, middle click picks; 1-9 or the wheel selects; E opens the block list
- Computers and Advanced Computers face the player when placed, show the "on" front texture, and each runs its own CraftOS. Right click opens the terminal; Shift + right click places against it; Esc closes
- Vanilla blocks with official textures: grass, dirt, stone, planks, logs, bricks, glass, wool, ore blocks and more
- The world, camera, hotbar and computer power state are saved in IndexedDB
- Isometric item icons are rendered from the block models, like Minecraft's inventory


**Milestone 1, one CraftOS computer in the browser**:

- Real ComputerCraft **1.75** `bios.lua` and CraftOS ROM, the last release for Minecraft 1.7.10 (see `vendor/computercraft/SOURCE.md`)
- Lua runs in [Fengari](https://fengari.io), patched to behave like CC's Lua 5.1 (see below)
- Each computer runs in its own Web Worker, so runaway programs hit "Too long without yielding" instead of freezing the page
- APIs: `term` (incl. `blit`), `fs`, `os` (timers, alarms, labels, clock/time/day), `peripheral`, `redstone`/`rs`, `bit`, `http`
- Terminal drawn with CC's own `termFont.png`, the 1.7 colour palette, and the GUI frame textures
- Keyboard (LWJGL key codes), `char`, `key_up`, `paste`, mouse click/drag/up/scroll, Ctrl+T/R/S hold shortcuts
- Files and the computer label are saved in IndexedDB

## Running

```sh
npm install        # also patches fengari, bundles the ROM and fetches Minecraft 1.7.10 textures
npm run dev        # http://localhost:5173
npm run build      # static build in dist/
npm run test:boot -- "ls" "lua" "1+1"   # boot CraftOS headlessly and print the screen
node test/world.test.cjs http://localhost:4173/ /tmp   # drive the 3D world in Chromium (after npm run preview)
npx vite-node test/sim.test.mjs      # monitors, disks, rednet and redstone headlessly
node test/peripherals.test.cjs http://localhost:4173/ /tmp   # the same in Chromium, with a screenshot
```

## Minecraft textures

Vanilla 1.7.10 textures (GUI, blocks, items, font) are downloaded by `npm run fetch:minecraft` into `public/assets/minecraft/` from a GitHub mirror of the client jar's assets. They belong to Mojang, so they are gitignored and never committed to this repository. Without them the page falls back to a CSS imitation of the Minecraft look.

## Lua 5.1 compatibility

Fengari implements Lua 5.3. `scripts/patch-fengari.cjs` (run on `postinstall`) and `src/computer/prelude.lua` close the gaps that matter for CC programs:

- All numeric literals are floats and integer arithmetic promotes on overflow, so `10/2` prints `5` and nothing wraps at 32 bits
- Numbers print with `%.14g`, like Lua 5.1
- Non-integral numbers passed where an integer is expected are truncated (`string.sub(s, 1.5)`, `("%d"):format(2.5)`)
- `setfenv`, `getfenv`, `loadstring`, `unpack`, `table.getn`/`maxn`, `math.pow`/`log10`/`ldexp`/`frexp`, `string.gfind`
- 5.3-only globals removed (`utf8`, `table.pack`, `math.type`, ...), plus everything CC removes (`io`, `debug`, `require`, ...)

## Layout

```
src/computer/   Lua runtime: computer.js (state, events, APIs), filesystem.js, terminal.js, prelude.lua, worker/host
src/ui/         TerminalRenderer (canvas), ComputerScreen (GUI frame + input), LWJGL key map, Minecraft font/theme
src/sim/        Simulation worker: all computers, peripherals, redstone and modems; SimClient on the page
src/world/      App (interaction, GUIs, saving), World (block map), WorldRenderer, Controls, blocks registry, textures, raycast
vendor/computercraft/   bios.lua + rom/ (bundled into src/generated/rom.json by scripts/build-rom.cjs)
public/assets/computercraft/textures/   ComputerCraft textures
```

## Roadmap

1. ~~One working CraftOS computer~~
2. ~~Three.js world: place and break computers and blocks, open a computer's terminal by clicking it~~
3. ~~Peripherals: disk drives, monitors (multiblock), wireless modems + rednet, redstone~~
4. Wired cables/modems, printers, turtles
5. Save/load worlds, import/export
6. Optional resource packs (e.g. Faithful 32x for 1.7.10)

ComputerCraft code and assets are by Daniel Ratcliffe and are under the ComputerCraft Public License (`vendor/computercraft/LICENSE`).
