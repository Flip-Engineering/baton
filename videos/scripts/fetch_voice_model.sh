#!/bin/sh
# Fetch the neural voice model for engine/voice_neural.py: Kokoro-82M v0.19 (int8, 11 English speakers, Apache-2.0)
# for sherpa-onnx, into videos/models/kokoro/ (gitignored), and pip-install sherpa-onnx.
#   videos/scripts/fetch_voice_model.sh            (idempotent: skips what is already there)
# Hugging Face and GitHub releases are blocked from the cloud sessions; npm and PyPI work, so the model comes out of
# an npm tarball that ships it (n8n-nodes-ttsbro 0.1.6: package/kokoro-int8-en-v0_19/).
# Voices stay OFF by default (ACP_VOICES / Song(voices=...)); this only makes the model available.
#
# --c2 (VOICE c2, 29 Sep): also fetch what the prosody layer (engine/voice/) uses, from Hugging Face (reachable since 29 Sep;
# the note above about HF being blocked is out of date):
#   Kokoro-82M v1.0 quantised ONNX (Apache-2.0) + 17 voices  -> models/voice/kokoro1/     (~95 MB)
#   Piper en_US-libritts_r-medium (CC BY 4.0)                -> models/voice/piper/       (~80 MB)
#   pip: onnxruntime soundfile pyloudnorm phonemizer-fork espeakng-loader piper-tts pyworld pocket-tts (pulls CPU torch)
#        faster-whisper (tiny.en, for the intelligibility aid in engine/voice/measure.py)
# Pocket TTS (CC-BY-4.0) downloads its own weights on first use. Chatterbox (MIT, watermarked) is NOT fetched: ~3 GB of
# weights against a tight disk (see research/capabilities/voice.md).
set -e
cd "$(dirname "$0")/.."                       # videos/
if [ "$1" = "--c2" ]; then
  HF=https://huggingface.co
  CA=""; [ -f /root/.ccr/ca-bundle.crt ] && CA="--cacert /root/.ccr/ca-bundle.crt"
  mkdir -p models/voice/kokoro1 models/voice/piper models/voice/ref
  K=models/voice/kokoro1
  [ -f $K/model_q.onnx ] || curl -fsSL $CA --retry 3 -o $K/model_q.onnx $HF/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx
  [ -f $K/tokenizer.json ] || curl -fsSL $CA --retry 3 -o $K/tokenizer.json $HF/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/tokenizer.json
  for v in am_adam am_michael am_echo am_eric am_fenrir am_liam am_onyx am_puck bm_daniel bm_fable bm_george bm_lewis af_heart af_bella af_nicole af_sarah af_kore; do
    [ -f $K/$v.bin ] || curl -fsSL $CA --retry 3 -o $K/$v.bin $HF/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/$v.bin
  done
  P=models/voice/piper; PB=$HF/rhasspy/piper-voices/resolve/main/en/en_US/libritts_r/medium
  [ -f $P/libritts_r.onnx ] || curl -fsSL $CA --retry 3 -o $P/libritts_r.onnx $PB/en_US-libritts_r-medium.onnx
  [ -f $P/libritts_r.onnx.json ] || curl -fsSL $CA --retry 3 -o $P/libritts_r.onnx.json $PB/en_US-libritts_r-medium.onnx.json
  pip install -q onnxruntime soundfile pyloudnorm phonemizer-fork espeakng-loader piper-tts pyworld faster-whisper || true
  python3 -c "import torch" 2>/dev/null || pip install -q torch --index-url https://download.pytorch.org/whl/cpu || true
  python3 -c "import pocket_tts" 2>/dev/null || pip install -q pocket-tts || true
  echo "voice c2: models in videos/models/voice (kokoro1, piper); real references: see research/capabilities/voice.md"
  exit 0
fi
DST=models/kokoro
URL=https://registry.npmjs.org/n8n-nodes-ttsbro/-/n8n-nodes-ttsbro-0.1.6.tgz
SUB=package/kokoro-int8-en-v0_19
python3 -c "import sherpa_onnx" 2>/dev/null || pip install -q "sherpa-onnx==1.13.8" || pip install -q sherpa-onnx
# pocketsphinx (bundled en-us model): forced word alignment for beat pins + the ASR checks in engine/voice_metrics.py.
# Optional: without it the pins fall back to the lexicon's vowel count and the ASR metrics are skipped.
python3 -c "import pocketsphinx" 2>/dev/null || pip install -q pocketsphinx || echo "voice model: pocketsphinx not installed (optional)"
if [ -f $DST/model.int8.onnx ] && [ -f $DST/voices.bin ] && [ -f $DST/tokens.txt ] && [ -d $DST/espeak-ng-data ]; then
  echo "voice model: present in videos/$DST"; exit 0
fi
mkdir -p $DST
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
CA=""; [ -f /root/.ccr/ca-bundle.crt ] && CA="--cacert /root/.ccr/ca-bundle.crt"
echo "voice model: downloading $URL (~100 MB)"
curl -fsSL $CA --retry 3 -o "$TMP/m.tgz" "$URL"
tar xzf "$TMP/m.tgz" -C "$TMP" "$SUB"
cp -r "$TMP/$SUB/." $DST/
# sanity: 11 speakers x 511 x 256 float32 style vectors
python3 - <<EOF
import os
n = os.path.getsize("$DST/voices.bin")
assert n == 11 * 511 * 256 * 4, n
print("voice model: ok (videos/$DST, 11 speakers)")
EOF
