"""MELTDOWN v13 (cycle 10): the script's single source. Writes research/scripts_final/meltdown.json (old v12 words go to
old_snippet) and web/scenes/meltdown8_words.js. One entry = one FRAME (what is on screen at once). A `*` pair marks the
stressed word (set in red on the beat); the row that holds it is the frame's key row: the frame's beat is the hit, on the
key row; the small words settle on the pickup just before it (Godard's cards, Mayakovsky's stepladder).
Flags: [V] verbatim from a checked source; [C] the client's own published words (CL175); 'ours' = the piece's own frames."""
import json, os, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
JSON = os.path.join(ROOT, 'research', 'scripts_final', 'meltdown.json')
JS = os.path.join(ROOT, 'videos', 'web', 'scenes', 'meltdown8_words.js')
LAND = 'NICK LAND, MELTDOWN, 1994'
CHAIR = 'EXECUTIVE CHAIRMAN, AMERICAN COMMUNIST PARTY'   # v19 (client 1 Oct, approved): the Chairman by title, the Party named, no interviewer, no TRANSCRIPT/EXCERPT apparatus
HAZ_WX = CHAIR
# (beat, rows, hold_beats, face, cite, verbatim, source)
W = [
 (0, ['THANK YOU,', '*MONOPOLY.*'], 4, 'hook', None, False, "Frame 0 (client 28 Sep): the board's own big cream flaps, MONOPOLY. in red, on a sub impact; the goods clatter round it. The thanks goes to the form, never to the monopolists (Engels in Capital III ch.27, 'the road has been paved ... for future expropriation', THEORY_CORPUS M18)."),
 (4, ['EVERY', '*PRICE.*'], 2, 'hook', None, False, "CL175 'monopoly is a search function': the search beam pings every price cell."),
 (6, ['EVERY', '*MACHINE.*'], 2, 'hook', None, False, "CL72 production: the cells flip to halftone machine plates on the hit."),
 (8, ['THE STORY', 'GOES LIKE', '*THIS:*'], 4, 'story', LAND, True, "[V] Land, Meltdown (1994), its first words: 'The story goes like this:' (ccru.net mirror). RESTORED from v1: Land's narrator's voice is taken over, and the story that follows is told from the class side (the party inverts his subject, THEORY_CORPUS 9.9). The colon is his."),
 (12, ['PROFIT COMES', 'FROM *WORKERS.*'], 4, 'ledger', None, False, "P (Marx, Capital III ch.13: only living labour yields surplus value). The ledger's rows WORKERS / MACHINES / PROFIT, on the board's flaps; the key word lands as the ledger's first values do."),
 (16, ['MACHINES', 'REPLACE', '*WORKERS.*'], 4, 'ledger', None, False, "P (Marx ch.13: constant capital grows against variable capital). WORKERS falls on the kick, MACHINES climbs; the wax-pencil profit-rate curve is redrawn lower and the ghosts kept. Key word on the kick."),
 (20, ['SO THE RATE OF', 'PROFIT TENDS', 'TO *FALL.*'], 4, 'ledger', None, False, "v20: the claim is now the consequence of the passage before it (SO). P (Marx ch.13: 'the tendency of the rate of profit to fall'; ch.13-14: the rate of profit falls as the share of living labour in the total capital falls, so long as the rate of surplus-value stays the same; v12 said FALLS, which reads as a law without counter-tendencies). The ledger's PROFIT flips to 7.9% on the hit, the same 7.9% the ratio before it ended on (158 / 2,000); the curve is redrawn lower. It is the reason the big capitals merge (the merge follows the counteracting influences)."),
 (28, ['COMPETITION', 'BECOMES', 'TRANSFORMED'], 4, 'lenin', 'LENIN, IMPERIALISM, 1916', True, "[V] Lenin, Imperialism ch.1: 'Competition becomes transformed into monopoly.' (THEORY_CORPUS L1). Set in two follow-on frames on the one row's red slab; the small words on the pickup, the verb stays."),
 (32, ['INTO', '*MONOPOLY.*'], 4, 'lenin', 'LENIN, IMPERIALISM, 1916', True, "[V] Lenin, second frame: the stressed word in red on the hit."),
 (36, ['MONOPOLY', 'IS A *SEARCH*', '*FUNCTION*', 'IN CAPITAL'], 8, 'search', None, True, "[C] CL175 verbatim, the client's own line, first half: 'monopoly is a search function in capital'. The beam runs down the one row over the whole market; the brass ALADDIN nameplate (Haz with Wang Xiao, price-signal search)."),
 (44, ['THAT', 'BIRTHS *AI*'], 4, 'fin', None, True, "[C] CL175, second half: '...that births AI through financialization of technology'. The columned exchange, its frieze a flap ticker at $690,000,000,000 (2026 big-tech AI capex, texture only)."),
 (48, ['THROUGH', '*FINANCIALIZATION*', 'OF TECHNOLOGY'], 4, 'fin', None, True, "[C] CL175, second frame of its second half: the hit is on the long word, not on THROUGH."),
 (52, ['ALL IN.'], 2, 'fin', None, False, "the poker call as the gold pours (recorded gang shout rising a step, x3): finance's bet on a new rate of profit."),
 (54, ['*AI.*'], 2, 'fin', None, False, "CL175 'births AI': the pour becomes the thinking lattice."),
 (56, ['MOST OF THE', 'SILICON VALLEY', '*STARTUPS*'], 4, 'loss', HAZ_WX, True, "[V, ASR] Haz with Wang Xiao (BV1CYB5BzEFq): 'most of the Silicon Valley startups in the USA ... ran at a loss'. RESTORED: v12 dropped the subject and left RAN AT A LOSS, with nobody. 'in the USA' is elided (an ellipsis in the credit line, not in the type)."),
 (60, ['RAN AT A', '*LOSS,*'], 2.5, 'loss', HAZ_WX, True, "[V, ASR] Haz with Wang Xiao: '... ran at a loss they didn't even turn profit'. A loss row flips to -14,000,000,000 in red, its flap edges char (a projected 2026 loss, The Information; texture only)."),
 (62.5, ['HOW IS PROFIT', 'ACTUALLY MADE', '*ANYMORE?*'], 5.5, 'loss', HAZ_WX, True, "[V, ASR] Haz with Wang Xiao: 'how is profit actually made anymore'. The question the ledger then answers. (His next words, 'it's kind of not', are the ledger's zero.)"),
 (68, ['A FEW', 'ESTABLISHED', '*BIG CAPITALS,*'], 3.5, 'marx', 'MARX, CAPITAL, VOL. III', True, "[V] Marx, Capital III ch.15 (M15): 'as soon as formation of capital were to fall into the hands of a few established big capitals, for which the mass of profit compensates for the falling rate of profit, the vital flame of production would be altogether extinguished. It would die out.' RESTORED (v12 carried only the weaker second sentence): the first sentence is monopoly to zero rate in Marx's own words. The middle clause is elided (the credit line says 'excerpt'); 'It would die out.' is left to the picture. c14: Marx now answers HOW IS PROFIT ACTUALLY MADE ANYMORE?; a pilot flame burns on the board from this frame and shrinks with each PROFIT flip while the ledger falls under him: WORKERS 400 -> 220 -> 90 -> 20 -> 0, PROFIT 7.9 -> 5.6 -> 3.1 -> 0.9 -> 0.0%."),
 (71.5, ['THE VITAL', 'FLAME OF', '*PRODUCTION*'], 3.5, 'marx', 'MARX, CAPITAL, VOL. III', True, "[V] Marx M15, continued."),
 (75, ['WOULD BE', 'ALTOGETHER', '*EXTINGUISHED.*'], 4, 'marx', 'MARX, CAPITAL, VOL. III', True, "[V] Marx M15: PROFIT reaches 0.0% on the hit and the pilot flame, tied to the rate of profit, gutters and goes out; the piece's one silence (b78-79) follows the flame-out. The tendency is Marx's; that it has arrived is the movement's verdict (Haz), and the ledger is where the piece shows it."),
 (79, ['POST-', '*ECONOMICS.*'], 4, 'post', None, False, "CL175, one word: the flaps fall off the board and leave empty sockets (c14: b79, after the flame goes out and the silence)."),
 (83, ['REPLACING', 'ALL LABOR', 'WITH *AI*'], 4, 'zero', CHAIR, True, "[V] Haz, 8 Sep 2026: 'Ironically, replacing all labor with AI will require communism, as the short-term costs will be too great to be justified by the profit motive.' c14 (client 2 Oct): moved to follow Marx and POST-ECONOMICS, so the argument runs from reason to conclusion. Set over the empty sockets: the first flaps back on the dead board, his type the only thing on it. The 'as ...' half is dropped; the clause carries the claim whole across two frames (v12 left only REPLACING ALL LABOR WITH AI, which read as a tech label). The credit says EXCERPT."),
 (87, ['WILL REQUIRE', '*COMMUNISM.*'], 5, 'zero', CHAIR, True, "[V] Haz, 8 Sep 2026, the clause continued, now ended with a full stop: it closes the movement, and the freeze that follows reads as the reaction to it. The strongest hit of the stretch; at b92 the glass chord cuts it cold."),
 (92, ['AS MARKETS', 'LEARN TO', 'MANUFACTURE', '*INTELLIGENCE,*'], 6, 'freeze', LAND, True, "[V] Land, Meltdown (1994): 'As markets learn to manufacture intelligence, politics modernizes, upgrades paranoia, and tries to get a grip.' RESTORED: v12 dropped the first clause, which is the joint between AI and the freeze. THE FREEZE, on the board: its search beam becomes a scanner over a wall of citizen files, each a card with a face (the public-domain Master Hands toolmakers, Flint 1936; the Hollerith card's punched holes)."),
 (98, ['POLITICS', 'MODERNIZES,', 'UPGRADES', '*PARANOIA,*'], 5, 'freeze', LAND, True, "[V] Land, continued. The scanner locks onto faces."),
 (103, ['AND TRIES TO', 'GET A *GRIP.*'], 3, 'freeze', LAND, True, "[V] Land, the sentence's end."),
 (106, ['THE', 'DICTATORSHIP', 'OF FINANCE', 'TAKES UP *AI:*'], 6, 'freeze', None, False, "ours, a synthesis (not a quote of any one source): the client's 29 Sep reading (the bourgeois dictatorship uses AI for a surveillance state; paraphrased at his request), Dimitrov 1935 ('the open terrorist dictatorship of ... finance capital'), Haz, RESPONSE TO CRITICS 2024 ('dictatorial consolidation of all institutions by the financial elites'), Lenin L5. Frost starts at the wall's edges."),
 (112, ['A', 'SURVEILLANCE', '*STATE,*'], 3, 'freeze', None, False, "ours: the client's surveillance state, grounded in the ACP's Palantir dispatch (Jun 2025: 'a database compiling the personal information of American citizens'). The wall's reticles lock onto the Flint faces."),
 (115, ['EVERY', 'CITIZEN', '*ON FILE,*'], 3, 'freeze', None, False, "ours, the sentence continued: every citizen a card, every card a face (the Hollerith cards' punched holes are the file)."),
 (118, ['TO FREEZE', 'THE LAWS AND', 'THE RULING', '*IDEAS*'], 5, 'freeze', None, False, "ours: 'freeze the superstructure' in plain words (PIECE_NOTES 6.1: the superstructure is the ruling ideas; Marx 1859 Preface; Hudson H7). v19: no stamps (the client, 8 Oct: no red stamp); the frost and the scanner carry the freeze."),
 (123, ['AND HOLD', 'ITS SEAT', 'ABOVE THE', '*CRISIS.*'], 7, 'freeze', None, False, "ours: the client's 'prolong its position above crisis'; Lenin L7, the shell 'which must inevitably decay if its removal is artificially delayed'. Ice reaches every card."),
 (130, ['JUST WHEN THE', 'ELITES THINK', 'THEY ARE THE', '*MOST POWERFUL,*'], 9, 'freeze', CHAIR, True, "[V, carried] Haz, 'MAGA COMMUNISM - A RESPONSE TO CRITICS' (x.com/InfraHaz/status/1797431662185185325, 3 Jun 2024; THEORY_CORPUS 8.3): 'Just when the elites think they are the most powerful, they are the least powerful.' The wall is frozen solid; the lattice starts to stir under the ice."),
 (139, ['THEY ARE', 'THE LEAST', '*POWERFUL.*'], 3, 'freeze', CHAIR, True, "[V, carried] Haz, continued, on the thunder."),
 (142, ['POST-ECONOMICS', '*RUNS AWAY*'], 2, 'turn', None, False, "ours, over the first crack: the client's 'post-economics runaway'; Land 'auto-sophisticating machine runaway'; Haz, POSTMAGA ch.2. The three cracks are the three bars of the equals sign."),
 (144, ['INTO A RACE', 'WITH *CHINA,*'], 2, 'turn', None, False, "ours, the second crack: the client's 'competition with China'; Land, 'Deregulation and the state arms-race each other into cyberspace'. China is named once, as the rival that forces the crisis."),
 (146, ['AND THE CRISIS', 'COMES *HOME.*'], 2, 'turn', None, False, "ours, the third crack: the client's 'internal instability'; Land's 'the metropolis is forced to re-endogenize its crisis'; Engels E3."),
 (148, ['*MELTDOWN.*'], 2, 'molten', None, False, "CL175: the frozen wall and the exchange come apart in chunks (Eisenstein, October); impact frame. The controllers' loss of control, not the machine's escape."),
 (150, ['MELT.'], 1, 'molten', None, False, "chant, high (once): deliberate syncopation, the shout on the off-beat."),
 (151, ['DOWN.'], 1.5, 'molten', None, False, "chant, low, on the boom."),
 (154, ['RIPS THROUGH', 'THE LAST', '*DREAMS* OF'], 5, 'machines', LAND, True, "[V-mirror] Land, Meltdown (ccru.net swarm1 mirror): 'An explosion of chaotic weather within synthetic problem-solving rips through the last dreams of top-down prediction and control.' A credited fragment set straight after MELTDOWN. / MELT. / DOWN., so the meltdown is what rips through (the source's subject is the weather, and no subject word is added). Land meant every controller, planners included; the next frames answer him. The machines lit and running, each tagged $0.00."),
 (159, ['TOP-DOWN', 'PREDICTION', '*AND CONTROL.*'], 6.5, 'machines', LAND, True, "[V-mirror] Land, the fragment's end."),
 (165.5, ['THE OPENING', 'IS OURS,', 'AS A *CLASS.*'], 5, 'plan', None, False, "ours: the client's 'for us to seize as class', paraphrased; Lenin L11: 'socialism is now gazing at us from all the windows of modern capitalism'. The board re-forms as a planning room (Cybersyn's Opsroom, as comparison)."),
 (170.5, ['THE AI THAT', 'WATCHED', '*PEOPLE*'], 3, 'plan', None, False, "ours, the answer to Land's 'top-down prediction and control': the difference is what is planned and who owns it (Engels E4; Kantorovich KA1; Haz with Wang Xiao on prices as accounting tools). The same machine, re-aligned: AI stays subordinate to the class."),
 (173.5, ['NOW PLANS', '*PRODUCTION.*'], 3, 'plan', None, False, "ours, continued. Glushkov (via Peters); Lange LA1. The work week flips 40 -> 36 on the board."),
 (176.5, ['NOT A', 'PREDICTION.', 'A *PLAN.*'], 3, 'plan', None, False, "v1's answer to Land (ours): a forecast watches a system it does not own; a plan is the producers deciding what is made. The work week 36 -> 32 (the Program's 'reducing the work week and laboring years')."),
 (179.5, ['AI-DRIVEN', 'NATIONAL', 'ECONOMIC', '*PLANNING*'], 4.5, 'program', 'ACP PROGRAM', True, "[V] ACP Program, plank 'Accelerate the Fourth Industrial Revolution': 'the implementation of AI-driven national economic planning'. Now on the board, not a white card."),
 (184, ['*NATIONALIZED.*'], 3.5, 'nat', None, False, "Client G7: monopoly is nationalized, not broken up. v19: set in the board's own flaps over the row's private brass nameplate (the stamp and the clipped-face crowd are gone)."),
 (187.5, ['EVERYTHING', 'IN ONE *HAND.*'], 5.5, 'poster', None, False, "once, earned (G7/G9): v19: a worker's hand and sleeved forearm from the studio's person pipeline, rising open in ember light; the second drop."),
 (193, ['THANK YOU,', '*MONOPOLY.*'], 3, 'poster', None, False, "the hook returns on the fist (four ACP bars on the knuckles): the loudest hit. Ember spray between the fingers as it closes (the v8 fist)."),
 (196, ['SINCERELY,', 'THE *WORKING CLASS.*'], 4, 'poster', None, False, "RESTORED from v8: the letter's signer, so the thanks has someone saying it. The four bars go to light and burst into the ACP gear; lockup b202 for 1.4 s; the last frames settle back onto the hook board (loop seam)."),
]
# v20: the falling-rate explanation. 12 beats go in before the claim (b20: competition; b24: the ratio; b28: Marx on living labour) and 8
# after it (b36: the counteracting influences; b40: AI as the limit). Every frame from the old b20 on moves by 12, and from the old b24 by 20.
def _sh(b): return b + (12 if b >= 20 else 0) + (8 if b >= 24 else 0)
W = [(_sh(b),) + tuple(rest) for b, *rest in W]
NEW = [
 (20, ['TO UNDERSELL', 'THE REST, EACH', '*AUTOMATES.*'], 4, 'explain', None, False, "ours (v20, the client's 17 Oct note: explain the tendency, as a transition into the claim). Why machines replace workers: competition. Each capital must cut costs to undersell the others, and a machine does it (Marx, Capital III ch.13-14: the development of the productive power of labour, expressed as a rising ratio of constant to variable capital; paraphrase, not a quotation). On the board the ledger from MACHINES REPLACE WORKERS. stays (700 / 40 / 12.1%)."),
 (24, ['THE SAME PROFIT', 'ON AN EVER', 'LARGER *CAPITAL.*'], 4, 'explain', None, False, "ours (v20): the mechanism as a ratio. Marx's formula p' = s / C = s / (c + v) (Capital III ch.13); the rate falls although the mass of profit holds or grows, because it sits on an ever larger total capital (ch.13: the fall 'does not rule out ... that the absolute mass of exploited labour ... may grow'; paraphrase). The ledger's flaps turn over into SURPLUS / CAPITAL / RATE: 121 on 1,000 = 12.1% (the rate the ledger had), then on b26 158 on 2,000 = 7.9% (the rate the claim lands on). On the glass above, RATE = s / (c + v): the c tile grows, the v tile shrinks, and under it the organic composition of capital rises (c : v)."),
 (28, ['AN EVER SMALLER', 'PORTION OF', '*LIVING LABOUR.*'], 4, 'explain', 'MARX, CAPITAL, VOL. III', True, "[V] Marx, Capital III ch.13 (Part III): 'any quantity of the average social capital, say, a capital of 100, comprises an ever larger portion or means of labour, and an ever smaller portion of living labour.' The quotation is cut to its last clause, 'an ever smaller portion of living labour', and the c tile of the formula is large and the v tile small as it lands: only living labour yields the surplus, and it is the part that shrinks."),
 (36, ['THE', 'COUNTERACTING', '*INFLUENCES:*'], 4, 'counter', 'MARX, CAPITAL, VOL. III', True, "[V] Marx, Capital III ch.14 (Part III): 'There must be some counteracting influences at work, which cross and annul the effect of the general law, and which give it merely the characteristic of a tendency'; the chapter's section is headed 'Counteracting Influences'. The words COUNTERACTING INFLUENCES are his; 'the' is ours. On the market board four rows land, one a beat: HARDER EXPLOITATION, LOWER WAGES, CHEAPER MACHINES, FOREIGN TRADE (ch.14 sections I-V in short: 'Increasing intensity of exploitation', 'Depression of wages below the value of labour-power', 'Cheapening of the elements of constant capital', 'Foreign trade'; the three short ones are paraphrase)."),
 (40, ['AI IS THE LIMIT:', 'NO ONE LEFT', 'TO *EXPLOIT.*'], 4, 'counter', None, False, "ours (v20): the movement's reading, not Marx's theorem (THEORY_CORPUS 1.3, honest scope: Marx's law is a tendency, and AI automation is its limit case, the mechanism in its purest form). Every counteracting influence works on living labour or its price; automate the labour and nothing is left to squeeze. The four rows go blank; the ledger then goes on to Lenin's competition becoming monopoly, and to zero under Marx's flame."),
]
W = sorted(W + NEW, key=lambda w: w[0])
CLOSE = 222
NOPICK = {99}
EMPH = {0, 32, 52, 68, 74, 82.5, 95, 107, 159, 168, 193.5, 199.5, 207.5, 213, 216}   # the frames the troupe answers (music_c3 'emph')
def plain(rows): return ' '.join(r.replace('*', '') for r in rows)
def main():
    old = json.load(open(JSON))
    rerun = 'v13' in (old.get('new_snippet') or '')
    old_snip = old['old_snippet'] if rerun else 'v12 words (beat, rows, hold): ' + json.dumps([[w['beat'], w['text'], w['hold']] for w in old['words']])
    words = []
    for b, rows, hold, face, cite, vb, src in W:
        w = {'beat': b, 'text': plain(rows), 'rows': [r.replace('*', '') for r in rows], 'hold': hold, 'face': face, 'source': src}
        if b in EMPH: w['emphasis'] = True
        if cite: w['cite'] = cite
        if vb: w['verbatim'] = True
        words.append(w)
    d = dict(old)
    d.update(words=words, reading=' / '.join(plain(r) for _, r, *_ in W),
      thesis=("Thank you, monopoly. The story goes like this (Land's first words, turned): profit comes from workers; machines replace them, because competition forces each capital to undersell the rest; the same profit sits on an ever larger capital, an ever smaller portion of it living labour (Marx, Capital III ch. 13: the ratio s / (c + v)); so the rate of profit tends to fall; the counteracting influences (Marx, ch. 14) only slow it, and AI is the limit, no one left to exploit; so the big capitals merge and competition becomes monopoly (Lenin). "
              "Monopoly is a search function in capital that births AI through financialization of technology (CL175); finance bets, most of the Silicon Valley startups ran at a loss, how is profit actually made anymore (Haz). "
              "Marx answers (ch. 15): a few established big capitals, the vital flame of production would be altogether extinguished; the ledger goes to zero and the pilot flame goes out with the rate of profit: post-economics. So replacing all labor with AI will require communism (Haz). "
              "Then the freeze, which is of the superstructure: as markets learn to manufacture intelligence, politics upgrades paranoia and tries to get a grip (Land); the dictatorship of finance takes up AI as a surveillance state, every citizen on file, to freeze the laws and the ruling ideas and hold its seat above the crisis (ours, from the client's reading, Dimitrov and Haz). "
              "It cannot hold: just when the elites think they are the most powerful they are the least powerful (Haz); post-economics runs away, into a race with China, and the crisis comes home; meltdown rips through the last dreams of top-down prediction and control (Land). "
              "The opening is ours, as a class: the AI that watched people now plans production; not a prediction, a plan; AI-driven national economic planning (Program); nationalized; everything in one hand, made of the faces it watched. Sincerely, the working class."),
      hook=old['hook'], chant=old['chant'], clip_line="THE RATE OF PROFIT TENDS TO FALL. / THE VITAL FLAME OF PRODUCTION WOULD BE ALTOGETHER EXTINGUISHED. / REPLACING ALL LABOR WITH AI WILL REQUIRE COMMUNISM. / THE AI THAT WATCHED PEOPLE NOW PLANS PRODUCTION.",
      old_snippet=old_snip, new_snippet="const WORDS = [ /* v13: generated from this JSON into web/scenes/meltdown8_words.js (_c10/build_words.py) */ ]",
      notes=("v13 (cycle 10, critic's brief videos/review/meltdown_c10/NOTES.md): 15 bars inserted (form.insert_bar) where the reading was: 1 story, 1 Lenin, 1 CL175, 1 startups, 1 ledger, 1 Marx, 6 freeze, 3 plan; the piece is 202 beats = 80.8 s + 1.4 s. "
             "Every sentence is on the board's big flap rows (function words on the pickup, the stressed word in red ON the hit: one stress per frame, the hit on the key row). Restored: THE STORY GOES LIKE THIS: (v1), Land's first clause, the startups as the subject, Marx's flame (M15 first sentence, pilot-flame picture), Haz 8 Sep's claim clause whole, the ember fist (v8) built from the file wall's faces (Klutsis). TENDS TO FALL replaces FALLS. "
             "c14 (2 Oct, client): Haz's REPLACING ALL LABOR WITH AI / WILL REQUIRE COMMUNISM. now follows Marx and POST-ECONOMICS (b83, b87; comma became a full stop); Marx is b68-79, POST b79. Cut: MARX M15's second sentence ('the rate of profit is the motive power... things are produced only so long as they can be produced with a profit') and the 'as the short-term costs...' half of Haz: given to the ledger's zero and the flame; word count the reading can carry. " + old.get('notes', '')[:0]))
    json.dump(d, open(JSON, 'w'), indent=1, ensure_ascii=False)
    lines = ['// GENERATED by _c10/build_words.py from research/scripts_final/meltdown.json (do not edit): [beat, rows (* = the stressed word), hold, face, cite]', 'export const WORDS = [']
    for b, rows, hold, face, cite, vb, src in W:
        lines.append(f"  [{b}, {json.dumps(rows)}, {hold}, {json.dumps(face)}, {json.dumps(cite)}],")
    lines += ['];', f'export const CLOSE_B = {CLOSE};', '']
    open(JS, 'w').write('\n'.join(lines))
    # the scansion sidecar (engine/score): the stress is the starred word, and the hit is ON it; the small rows come on the pickup (0.75 beat before)
    SC = os.path.join(ROOT, 'research', 'scansion', 'meltdown.json')
    sc = json.load(open(SC)); cards = []
    for b, rows, hold, face, cite, vb, src in W:
        text = plain(rows); starred = [seg for r in rows for seg in re.findall(r'\*([^*]+)\*', r)]
        e = {'beat': b}
        if starred:
            e['nuclear_word'] = re.sub(r"[^A-Z0-9-]", '', starred[-1].split()[-1].upper())
        elif face not in ('hook', 'molten'):
            e['nuclear_word'] = re.sub(r"[^A-Z0-9-]", '', text.split()[-1].upper())
        e['on'] = b
        if face not in ('hook', 'molten') and b not in NOPICK: e['cut'] = round(b - 0.75, 2)
        if face in ('poster', 'plan', 'freeze', 'machines', 'marx', 'zero', 'loss', 'search', 'fin', 'ledger', 'lenin', 'story', 'program', 'turn', 'post') and len(text) > 14: e['hit'] = False
        if text in ('MELT.', 'DOWN.', 'ALL IN.'): e['sync'] = 'deliberate'
        cards.append(e)
    sc['cards'] = cards
    sc['note'] = ("SCANSION c1 sidecar, rewritten by MELTDOWN c10 (v13): every frame's stressed word is the starred word of the script rows, "
                  "and the song's hit is ON it (on = the frame's beat); the small rows come on the pickup (cut = beat - 0.75 = 0.3 s), so no frame opens "
                  "on a hit under a weak word. Sentences are read, not shouted (hit:false). MELT. / DOWN. and ALL IN. are deliberate syncopation.")
    json.dump(sc, open(SC, 'w'), indent=1, ensure_ascii=False); print('ok', len(W), 'frames;', len(cards), 'scansion cards')
if __name__ == '__main__': main()
