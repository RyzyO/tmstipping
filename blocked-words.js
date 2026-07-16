// Blocklist for tipper display names (team_name).
// Review this list before it's wired up anywhere — nothing in this file is
// enforced yet. Each entry is matched against a NORMALIZED version of the
// submitted name (lowercased, accents stripped, common leetspeak collapsed,
// spaces/punctuation/repeated letters removed) so "f u c k", "fuuuck", and
// "fvck" all match the same entry as "fuck". You don't need to list every
// leetspeak variant below — just the base word.
//
// Edit freely: remove words you don't want blocked, add ones you do.
// Two lists: SLURS (always block, no exceptions) and PROFANITY (block, but
// more likely to have legitimate false positives worth reviewing case by case).

export const SLURS = [
  // Racial / ethnic slurs
  'nigger', 'nigga', 'chink', 'gook', 'spic', 'wetback', 'beaner',
  'coon', 'jigaboo', 'sambo', 'darkie', 'porch monkey', 'towelhead',
  'raghead', 'sandnigger', 'paki', 'curry muncher', 'abo', 'boong',
  'coconut', 'redskin', 'injun', 'gyppo', 'gypo', 'pikey', 'kike',
  'yid', 'zipperhead', 'slant', 'slope', 'ching chong', 'jap' /* as slur usage */,

  // Homophobic / transphobic slurs
  'faggot', 'fag', 'dyke', 'tranny', 'shemale', 'lady boy', 'ladyboy',
  'homo', 'poof', 'poofter', 'fairy', 'queer' /* context-dependent, included for review */,

  // Ableist slurs
  'retard', 'retarded', 'spastic', 'spaz', 'mongoloid', 'cripple',
  'imbecile', 'moron' /* borderline, included for review */,

  // Misogynistic slurs
  'cunt', 'whore', 'slut', 'bitch', 'skank', 'thot',

  // Religious / other hate terms
  'infidel' /* borderline, included for review */,
];

export const PROFANITY = [
  // General swears
  'fuck', 'fuk', 'fck', 'shit', 'shyt', 'piss', 'crap', 'damn',
  'bastard', 'bollocks', 'bugger', 'wanker', 'twat', 'arse', 'ass',
  'dick', 'dickhead', 'prick', 'douche', 'douchebag', 'jackass',
  'asshole', 'arsehole', 'motherfucker', 'goddamn', 'bloody hell',

  // Sexual / genitalia terms
  'penis', 'vagina', 'genitalia', 'cock', 'dildo', 'boner', 'cum',
  'jizz', 'blowjob', 'handjob', 'anal', 'porn', 'pornhub', 'xxx',
  'sex', 'orgasm', 'masturbate', 'masturbation', 'clit', 'clitoris',
  'testicle', 'testicles', 'nutsack', 'ballsack', 'labia', 'foreskin',
  'sperm', 'semen', 'ejaculate', 'ejaculation', 'rape', 'rapist',

  // Drug references (optional — remove if too broad for your comp)
  'cocaine', 'heroin', 'meth', 'weed' /* borderline, included for review */,

  // Scatological
  'poop', 'turd', 'feces', 'faeces',
];

// --- Matching strategy (already implemented, not yet wired up anywhere) ---
//
// 1. Normalize the candidate name:
//    - lowercase
//    - strip accents (NFD normalize + strip combining marks)
//    - collapse common leetspeak: 0->o, 1->i/l, 3->e, 4->a, 5->s, 7->t, @->a, $->s
//    - remove all non-alphanumeric characters (spaces, punctuation, emoji)
//    - collapse 3+ repeated letters down to 1 (e.g. "fuuuuck" -> "fuck")
// 2. Check if the normalized string CONTAINS any normalized blocklist entry
//    as a substring (not just exact match — catches "fuckyeah123" etc.)
// 3. Also check word-boundary-safe variants for multi-word entries
//    (e.g. "porch monkey" normalizes to "porchmonkey" and is matched the
//    same way as a single word after normalization).
//
// Known limitation: substring matching will also flag some legitimate
// names that happen to contain a blocked substring (e.g. a hypothetical
// "Class1c" type name colliding with a leet-collapsed word). Review the
// lists above with that in mind — shorter/common-letter-sequence entries
// are more prone to false positives than longer ones.
