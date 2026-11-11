# Collection specs (closer rule: ONE ☭≡/acc card, about 1.4 s)

The client rule: one brand card, the kit `closer()`, about 1.4 s. No tagline or sigil card before it, and no long ACP card.
Several scenes still draw a second card before the closer. Until each scene is fixed at source, `collect.sh` cuts it out
on bar lines, so the music jump lands on a downbeat:

    sh videos/scripts/collect.sh <scene> <bpm> <DeliverName> [cut=A-B | trim=BEAT]

| scene (and its builds) | closer beat | fix at collection | why |
|---|---|---|---|
| meltdown7 | 72 | cut=68-72 | the cloud forms the ☭≡/acc lockup at 68-72 before the closer; keep the gear mark under THE WORKING CLASS. (64-68) |
| bank2 | 72 | cut=64-72 | the red banner-field sigil card at 64-72; keep MONEY. on the note (60-64) |
| frontier2 | 104 | cut=100-104 | the tagline sigil card at 100-104; GARY, 2036. goes straight into the closer |
| commonwealth2 | 64 (scene) | trim=64 | the scene's own cream lockup starts at 64, but the farm spec cut at 72 (4.4 s card) |
| meltdown8, bank3, frontier3 | 72 / 72 / 104 | none: builders wrote one closer (checked in source) | read the tail anyway |
| commonwealth3 | 72 | none: its world runs to 72, then one closer | read the tail anyway |
| horde3 | 104 | none (check the tail) | the mark formed by grains at 88-96 is in-world, under THE MOTOR / OF HISTORY. |
| red_wedge3, empire3, productive2, ascended2, intelligence2, rejuvenation2, ownfuture2 | 64 / 64 / 64 / 64 / 72 / 64 / 64 | none expected (builders were told: one card) | check the tail strip anyway |

Always read `videos/review/<scene>_tail.jpg` after collecting: exactly one card, and it lasts about 1.4 s.
When the music v2 songs land (research/MUSIC_BIBLE.md), fix the scenes at source instead (no second card, closer on the
song's closer beat) and drop the cut.
