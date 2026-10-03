#!/usr/bin/env bash
set -euo pipefail

# Run with Emscripten 4.0.15 activated, CMake 3.31.6 and Ninja 1.11.1 on PATH.
root=$(cd "$(dirname "$0")/../.." && pwd)
build_root=${NESTING_BUILD_DIR:-/tmp/dome-nesting-native-source}
mkdir -p "$build_root"
command -v emcmake >/dev/null
command -v cmake >/dev/null

fetch_source() {
  local name=$1 repo=$2 revision=$3
  if [[ ! -d "$build_root/$name" ]]; then
    curl --fail --location --retry 3 "https://codeload.github.com/$repo/tar.gz/$revision" -o "$build_root/$name.tar.gz"
    mkdir -p "$build_root/$name"
    tar -xzf "$build_root/$name.tar.gz" -C "$build_root/$name" --strip-components=1
  fi
}
fetch_source libnest2d tamasmeszaros/libnest2d 663daa69e1d7478669f714218e27681edbc96640
fetch_source clipper tamasmeszaros/libpolyclipping 784ff113071f1fa7832ebe74667f2fd0756c634f
fetch_source nlopt stevengj/nlopt 09b3c2a6da71cabcb98d2c8facc6b83d2321ed71
if [[ ! -d "$build_root/boost_1_85_0" ]]; then
  curl --fail --location --retry 3 https://archives.boost.io/release/1.85.0/source/boost_1_85_0.tar.bz2 -o "$build_root/boost.tar.bz2"
  echo "7009fe1faa1697476bdc7027703a2badb84e849b7b0baad5086b087b971f8617  $build_root/boost.tar.bz2" | sha256sum -c -
  tar -xjf "$build_root/boost.tar.bz2" -C "$build_root" boost_1_85_0/boost boost_1_85_0/LICENSE_1_0.txt
fi

emcmake cmake -S "$root/native/nesting" -B "$build_root/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DLIBNEST2D_SOURCE="$build_root/libnest2d" -DCLIPPER_SOURCE="$build_root/clipper" \
  -DNLOPT_SOURCE="$build_root/nlopt" -DBOOST_SOURCE="$build_root/boost_1_85_0" \
  -DOUTPUT_DIR="$root/src/vendor/libnest2d"
cmake --build "$build_root/build" -j 4
