#!/usr/bin/env bash
# Downloads the vanilla Minecraft 1.7.10 textures and font into public/assets/minecraft/.
# They are Mojang's assets, so they are fetched locally and never committed (see .gitignore).
# Source: https://github.com/InventivetalentDev/minecraft-assets (branch 1.7.10), a mirror of the client jar's assets.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=public/assets/minecraft
if [ -d "$DEST/textures/blocks" ] && [ "${1:-}" != "--force" ]; then echo "Minecraft assets already present"; exit 0; fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 --branch 1.7.10 --filter=blob:none --sparse https://github.com/InventivetalentDev/minecraft-assets "$TMP/mc"
git -C "$TMP/mc" sparse-checkout set assets/minecraft/textures/blocks assets/minecraft/textures/gui assets/minecraft/textures/items assets/minecraft/textures/font assets/minecraft/textures/environment assets/minecraft/textures/colormap
rm -rf "$DEST"; mkdir -p "$DEST"
cp -r "$TMP/mc/assets/minecraft/textures" "$DEST/"
echo "Fetched $(find "$DEST" -name '*.png' | wc -l) Minecraft 1.7.10 textures into $DEST"
