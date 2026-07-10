import { describe, it, expect } from 'vitest';
import { resolveScoredHorseId, calculateTipPoints, calculateCompPoints } from '../scoring.js';

describe('Scoring Logic', () => {
  describe('resolveScoredHorseId', () => {
    it('returns tipped horse when not scratched', () => {
      const race = {
        horses: {
          'h1': { name: 'Horse 1', scratched: false },
          'h2': { name: 'Horse 2', scratched: false, substitute: true }
        }
      };
      expect(resolveScoredHorseId(race, 'h1')).toBe('h1');
    });

    it('falls to substitute when tipped horse is scratched', () => {
      const race = {
        horses: {
          'h1': { name: 'Horse 1', scratched: true },
          'h2': { name: 'Horse 2', scratched: false, substitute: true }
        }
      };
      expect(resolveScoredHorseId(race, 'h1')).toBe('h2');
    });

    it('returns original horse if scratched but no substitute exists', () => {
      const race = {
        horses: {
          'h1': { name: 'Horse 1', scratched: true },
          'h2': { name: 'Horse 2', scratched: false }
        }
      };
      expect(resolveScoredHorseId(race, 'h1')).toBe('h1');
    });

    it('handles null/undefined race', () => {
      expect(resolveScoredHorseId(null, 'h1')).toBe('h1');
      expect(resolveScoredHorseId(undefined, 'h1')).toBe('h1');
    });
  });

  describe('calculateTipPoints', () => {
    const race = {
      id: 'r1',
      horses: {
        'h1': { name: 'Winner', scratched: false },
        'h2': { name: 'Second', scratched: false }
      }
    };

    it('awards points for winning tip', () => {
      const result = {
        winning_horse_id: 'h1',
        points: 10,
        place1_horse_id: 'h2',
        place1_points: 5,
        place2_horse_id: null,
        place2_points: 0
      };
      expect(calculateTipPoints(race, result, 'h1', false)).toBe(10);
    });

    it('awards points for place1 tip', () => {
      const result = {
        winning_horse_id: 'h1',
        points: 10,
        place1_horse_id: 'h2',
        place1_points: 5
      };
      expect(calculateTipPoints(race, result, 'h2', false)).toBe(5);
    });

    it('multiplies points by 2 when joker used', () => {
      const result = {
        winning_horse_id: 'h1',
        points: 10,
        place1_horse_id: 'h2',
        place1_points: 5
      };
      expect(calculateTipPoints(race, result, 'h1', true)).toBe(20);
    });

    it('returns 0 for no match', () => {
      const result = {
        winning_horse_id: 'h1',
        points: 10,
        place1_horse_id: 'h2',
        place1_points: 5
      };
      expect(calculateTipPoints(race, result, 'h99', false)).toBe(0);
    });

    it('respects substitute when tipped horse is scratched', () => {
      const raceWithSub = {
        ...race,
        horses: {
          'h1': { name: 'Winner', scratched: true },
          'h2': { name: 'Substitute', scratched: false, substitute: true }
        }
      };
      const result = {
        winning_horse_id: 'h2',
        points: 10
      };
      expect(calculateTipPoints(raceWithSub, result, 'h1', false)).toBe(10);
    });

    it('does not multiply joker if points are zero', () => {
      const result = {
        winning_horse_id: 'h1',
        points: 10
      };
      expect(calculateTipPoints(race, result, 'h2', true)).toBe(0);
    });
  });

  describe('calculateCompPoints', () => {
    it('aggregates points across multiple tips', () => {
      const races = [
        { id: 'r1', horses: { 'h1': { name: 'Horse 1' }, 'h2': { name: 'Horse 2' } } },
        { id: 'r2', horses: { 'h1': { name: 'Horse 1' }, 'h2': { name: 'Horse 2' } } }
      ];
      const tips = [
        { user_id: 'u1', race_id: 'r1', horse_id: 'h1', joker: false },
        { user_id: 'u1', race_id: 'r2', horse_id: 'h2', joker: false }
      ];
      const results = [
        { race_id: 'r1', winning_horse_id: 'h1', points: 10, place1_horse_id: 'h2', place1_points: 5 },
        { race_id: 'r2', winning_horse_id: 'h2', points: 10, place1_horse_id: 'h1', place1_points: 5 }
      ];

      const { userPoints, userWins } = calculateCompPoints(races, tips, results);
      expect(userPoints['u1']).toBe(20); // r1: 10 (h1 won) + r2: 10 (h2 won) = 20
      expect(userWins['u1']).toBe(2); // won twice (h1 in r1, h2 in r2)
    });

    it('handles multiple users independently', () => {
      const races = [
        { id: 'r1', horses: { 'h1': { name: 'Horse 1' }, 'h2': { name: 'Horse 2' } } }
      ];
      const tips = [
        { user_id: 'u1', race_id: 'r1', horse_id: 'h1', joker: false },
        { user_id: 'u2', race_id: 'r1', horse_id: 'h2', joker: false }
      ];
      const results = [
        { race_id: 'r1', winning_horse_id: 'h1', points: 10, place1_horse_id: 'h2', place1_points: 5 }
      ];

      const { userPoints } = calculateCompPoints(races, tips, results);
      expect(userPoints['u1']).toBe(10);
      expect(userPoints['u2']).toBe(5);
    });

    it('applies joker multiplier correctly', () => {
      const races = [{ id: 'r1', horses: { 'h1': { name: 'Horse 1' } } }];
      const tips = [{ user_id: 'u1', race_id: 'r1', horse_id: 'h1', joker: true }];
      const results = [{ race_id: 'r1', winning_horse_id: 'h1', points: 10 }];

      const { userPoints } = calculateCompPoints(races, tips, results);
      expect(userPoints['u1']).toBe(20); // 10 * 2
    });
  });
});
