// Short words only, so a name stays readable in a branch menu: `worktree-brave-humming-otter`.
const ADJECTIVES = [
  'amber', 'bold', 'brave', 'breezy', 'bright', 'calm', 'clever', 'cosmic', 'cozy', 'crisp',
  'curious', 'daring', 'dreamy', 'eager', 'fancy', 'fizzy', 'fuzzy', 'gentle', 'giddy', 'glossy',
  'golden', 'happy', 'jolly', 'keen', 'lively', 'lucky', 'mellow', 'merry', 'misty', 'nimble',
  'noble', 'peppy', 'plucky', 'quiet', 'quick', 'rapid', 'rosy', 'shiny', 'silent', 'silky',
  'snappy', 'snowy', 'sunny', 'swift', 'tidy', 'tiny', 'velvet', 'vivid', 'witty', 'zesty',
];

const VERBS = [
  'baking', 'blooming', 'bouncing', 'brewing', 'building', 'buzzing', 'chasing', 'climbing', 'crafting', 'dancing',
  'dashing', 'diving', 'drifting', 'dreaming', 'floating', 'flying', 'gliding', 'glowing', 'growing', 'hiking',
  'hopping', 'humming', 'jumping', 'juggling', 'knitting', 'leaping', 'mixing', 'painting', 'pondering', 'racing',
  'roaming', 'rolling', 'rowing', 'running', 'sailing', 'singing', 'skating', 'sliding', 'soaring', 'spinning',
  'sprouting', 'surfing', 'swimming', 'tinkering', 'tumbling', 'twirling', 'wading', 'wandering', 'whistling', 'zooming',
];

const NOUNS = [
  'acorn', 'badger', 'beacon', 'bison', 'canyon', 'cedar', 'comet', 'coral', 'crane', 'dune',
  'ember', 'falcon', 'fern', 'finch', 'fjord', 'fox', 'galaxy', 'garnet', 'gecko', 'glacier',
  'harbor', 'heron', 'island', 'koala', 'lagoon', 'lantern', 'lemur', 'lynx', 'maple', 'meadow',
  'meteor', 'nebula', 'oasis', 'orchid', 'otter', 'owl', 'panda', 'pebble', 'pine', 'puffin',
  'quokka', 'raven', 'reef', 'river', 'sparrow', 'summit', 'tiger', 'tulip', 'walrus', 'willow',
];

const pick = (words: readonly string[], random: () => number) => words[Math.floor(random() * words.length) % words.length]!;

/**
 * A random worktree name of three short words, `brave-humming-otter`, in the style Claude Code uses for the names it makes up.
 * Plain TypeScript: the engine (a queued item starting) and the UI both name worktrees this way.
 * `random` can be passed in so tests can pin the words.
 */
export function randomWorktreeName(random: () => number = Math.random): string {
  return [pick(ADJECTIVES, random), pick(VERBS, random), pick(NOUNS, random)].join('-');
}
