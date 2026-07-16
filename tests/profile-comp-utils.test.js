import { describe, expect, it } from 'vitest';
import { mergeCompJoiningsForProfile, selectProfileCompJoining } from '../profile-comp-utils.js';

describe('mergeCompJoiningsForProfile', () => {
  it('merges duplicate joinings for the same comp and prefers the completed row', () => {
    const joinings = [
      { comp_id: 'comp-1', payment_status: 'pending', points: 10, rank: 20 },
      { comp_id: 'comp-1', payment_status: 'completed', points: 50, rank: 2 },
      { comp_id: 'comp-2', payment_status: 'pending', points: 15, rank: 10 }
    ];

    const merged = mergeCompJoiningsForProfile(joinings);

    expect(merged).toHaveLength(2);
    expect(merged.find((joining) => joining.comp_id === 'comp-1')).toMatchObject({
      comp_id: 'comp-1',
      payment_status: 'completed',
      points: 50,
      rank: 2
    });
  });

  it('prefers the higher-scoring row when both rows are completed', () => {
    const joinings = [
      { comp_id: 'comp-3', payment_status: 'completed', points: 10, rank: 15 },
      { comp_id: 'comp-3', payment_status: 'completed', points: 30, rank: 5 }
    ];

    const merged = mergeCompJoiningsForProfile(joinings);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ comp_id: 'comp-3', points: 30, rank: 5 });
  });

  it('returns the joining for the preferred comp when it exists', () => {
    const joinings = [
      { comp_id: 'comp-1', payment_status: 'completed', points: 20, rank: 8 },
      { comp_id: 'comp-2', payment_status: 'completed', points: 35, rank: 3 }
    ];

    expect(selectProfileCompJoining(joinings, 'comp-2')).toMatchObject({ comp_id: 'comp-2', rank: 3 });
  });
});
