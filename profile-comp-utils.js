export function mergeCompJoiningsForProfile(joinings = []) {
  const completedJoinings = (joinings || []).filter((joining) => joining?.payment_status === 'completed');
  const bestByCompId = new Map();

  for (const joining of completedJoinings) {
    const existing = bestByCompId.get(joining.comp_id);
    if (!existing || Number(joining.points || 0) > Number(existing.points || 0)) {
      bestByCompId.set(joining.comp_id, joining);
    }
  }

  const pendingJoinings = (joinings || []).filter((joining) => joining?.payment_status !== 'completed');
  for (const joining of pendingJoinings) {
    const existing = bestByCompId.get(joining.comp_id);
    if (!existing) {
      bestByCompId.set(joining.comp_id, joining);
    }
  }

  return [...bestByCompId.values()];
}

export function selectProfileCompJoining(joinings = [], preferredCompId = null) {
  const list = (joinings || []).filter((joining) => joining?.comp_id);
  if (preferredCompId) {
    const matching = list.find((joining) => joining.comp_id === preferredCompId);
    if (matching) return matching;
  }

  const completedJoinings = list.filter((joining) => joining.payment_status === 'completed');
  return completedJoinings[0] || list[0] || null;
}
