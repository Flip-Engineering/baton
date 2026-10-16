# Flip series avatars

`base-character.svg` contains the editable Flip character in semantic groups. The shared pink body, pale face, eye style, freckles, and mint accents come from the thinking mascot. Each series has a pose SVG that replaces named face and hand groups, accessory SVG modules, and an official brand emblem SVG.

Edit geometry in the named SVG groups. Edit the CSS palette variables in the base or accessory SVGs. `series.json` selects each pose, its rotation, accessory sources, placement anchors, front or back layers, and emblem transforms. Foreground hand layers render after the accessories. Emblem path geometry remains intact in its own source file.

Run `python3 generate.py` with Python 3 and `rsvg-convert` available on `PATH`. The generator writes editable SVGs and 200, 60, and 32 px PNGs to `avatars/`, plus the gallery in `index.html`. Generated avatar SVGs use resolved colors for standalone rendering. Palette variables remain in the editable source modules. Avatar SVGs contain vector geometry without rendered text or embedded raster images.

`source-provenance.json` records the original Flip mascot commit and hashes, the operator reference image download, primary brand sources, and emblem extraction details. The reference copies retain the original bytes. The pose choices are illustration interpretations of the published brand materials. The third-party marks belong to their respective owners.

| Series | Primary brand source |
| --- | --- |
| GPT | [OpenAI design guidelines](https://openai.com/brand/) |
| Claude | [Claude](https://claude.com/) |
| DeepSeek | [DeepSeek](https://www.deepseek.com/) |
| Kimi | [Kimi brand resources](https://www.kimi.com/resources/kimi-brand) |
| Muse | [Muse](https://introducing.muse.ai/) |
| GLM | [Z.ai](https://z.ai/) |
