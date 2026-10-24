// What the rating strip in a conversation shows (see test/ratings.test.js).
// The server decides who may rate: only the buyer, after a completed meetup
// or sale (reason needs_transaction before that, buyer_only for the seller).
//   'strip': ratings to show or a rating to give; 'hint': the buyer, before
//   the meetup or sale is done; 'none': nothing (e.g. the seller with no ratings).
export function ratePrompt(d) {
  if (!d || !d.other) return 'none';
  if (d.mine || d.theirs || d.canRate) return 'strip';
  return d.reason === 'needs_transaction' ? 'hint' : 'none';
}
