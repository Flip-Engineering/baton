"""Write research/scripts_final/unrecognizable.json from scenes/unrecognizable.cards.json (the words on screen live in one place).
    python3 videos/web/scenes/unrecognizable_script.py"""
import json, os
R = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
C = json.load(open(os.path.join(R, 'videos/web/scenes/unrecognizable.cards.json')))
SRC = {
    'c4': 'Haz Al-Din, Executive Chairman, ACP, @InfraHaz, 4 Oct 2026 21:45 UTC, https://x.com/InfraHaz/status/2106863221197939007 '
          '(research/sources/texts/x-infrahaz-2026-10.txt:5; re-read live via api.fxtwitter.com 16 Oct 2026) [V-file, V-fx]',
    'c3': 'Haz Al-Din, Executive Chairman, ACP, @InfraHaz, 3 Oct 2026 18:44 UTC, https://x.com/InfraHaz/status/2106455359867220260 '
          '(x-infrahaz-2026-10.txt:3; re-read live 16 Oct 2026) [V-file, V-fx]',
    'prog': 'ACP Program, "Abolition of Intellectual Property", https://acp.us/program (research/sources/texts/acp-program.txt:61-63; '
            're-read live 16 Oct 2026) [V-file, V-live]',
}
words = [{'beat': c['beat'], 'end': c['end'], 'text': c['text'], 'kind': 'quote', 'verbatim': True, 'source': SRC[c['src']],
          'credit_on_screen': C['credits'][c['src']] if (c['src'] != 'c4' or c['beat'] < 22 or c['beat'] >= 72) else None} for c in C['cards']]
out = {
    'piece': 'UNRECOGNIZABLE', 'title': 'UNRECOGNIZABLE', 'series': 'UNRECOGNIZABLE', 'scene': 'unrecognizable', 'take': 'a',
    'updated': '2026-10-16 (v1)', 'bpm': 'tempo map 96 -> 148 -> brake to 82 -> 138 -> 174 (songs2/unrecognizable_e.py TEMPO); nominal 125.47 so beat 120 = 57.38 s',
    'closer_beat': 120, 'song': "web/audio/songs2/unrecognizable_e.py, song()",
    'hook': 'frame 0: a bad copy of a real engineering drawing (HAER VI-4, a horizontal steam engine) with the copier\'s light bar already '
            'passing; under it the copy comes out sharper, on AI IS ACCELERATING',
    'idea': 'Copying as clarity: every copy of the drawing comes out sharper and more complete than the last, the copies spread across '
            'the table to the people who build from them, the title blocks (PROPRIETARY / DO NOT REPRODUCE) grow until they cover the '
            'drawings and stop the machines, and on IMMEDIATELY ABOLISH ALL INTELLECTUAL PROPERTY. one cut takes them off every sheet at once.',
    'elisions': [
        '4 Oct post: "We are not approaching AGI or singularity. But" before AI IS ACCELERATING is not shown (the piece opens on the claim; '
        'the dropped "But" is a connective, recorded here).',
        '4 Oct post: the passages on dhawq, Sufism, athleticism, cultivation, Iran and world war are not shown; the 4 Oct material ends at '
        'STANDS IN THE WAY. ("...to prevent this real Communism" and "Do you find this crazy?" left out: both point back at cut passages).',
        '3 Oct post: only its first sentence is shown.',
        'Program: the plank\'s first sentence; its second (entertainment and music industries) is not shown.'],
    'words': words,
}
json.dump(out, open(os.path.join(R, 'research/scripts_final/unrecognizable.json'), 'w'), indent=1, ensure_ascii=False)
print('wrote', len(words), 'cards')
