#!/bin/sh
# Surge XT (GPL-3) for engine/daw/surge.py: download the Linux .deb release once and unpack it into ~/.cache/surge-xt (no root package
# install), then link its data where the plugin looks.  ~600 MB unpacked.  The farm does not need it: songs commit their rendered stems.
set -e
V=1.3.4
D="$HOME/.cache/surge-xt"
[ -e "$D/usr/lib/vst3/Surge XT.vst3" ] && { [ -e /usr/share/surge-xt ] || ln -s "$D/usr/share/surge-xt" /usr/share/surge-xt; echo "surge-xt: present"; exit 0; }
mkdir -p "$D"
T=$(mktemp -d)
curl -sSL -o "$T/surge.deb" "https://github.com/surge-synthesizer/releases-xt/releases/download/$V/surge-xt-linux-x64-$V.deb"
dpkg-deb -x "$T/surge.deb" "$D"
rm -rf "$T"
[ -e /usr/share/surge-xt ] || ln -s "$D/usr/share/surge-xt" /usr/share/surge-xt
python3 -c "import mido" 2>/dev/null || pip install -q mido
echo "surge-xt: installed in $D"
