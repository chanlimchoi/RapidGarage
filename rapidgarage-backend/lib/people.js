// What one user may see about another: first name + last initial, never email.
function publicName(user) {
  if (!user) return 'Former user';
  const first = String(user.firstName || '').trim();
  const last = String(user.lastName || '').trim();
  if (!first && !last) return 'RapidGarage user';
  if (!first) return last.charAt(0).toUpperCase() + '.';
  return last ? first + ' ' + last.charAt(0).toUpperCase() + '.' : first;
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, name: publicName(user) };
}

module.exports = { publicName, publicUser };
