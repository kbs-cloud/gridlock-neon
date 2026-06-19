import { SeededRandom } from './SeededRandom';

export interface TrackElement {
  dist: number; // distance in meters
  lane: number; // 0 (left), 1 (center), 2 (right)
  type: 'obstacle' | 'jump_obstacle' | 'duck_obstacle' | 'note';
  collected?: boolean;
}

export const generateTrack = (seed: number, targetDist: number): TrackElement[] => {
  const list: TrackElement[] = [];
  const rand = new SeededRandom(seed);
  
  // Spawn elements every 35-50 meters
  let curDist = 60;
  while (curDist < targetDist - 30) {
    const val = rand.next();
    const lane = Math.floor(rand.next() * 3);
    
    if (val < 0.25) {
      list.push({ dist: curDist, lane, type: 'note' });
    } else if (val < 0.5) {
      list.push({ dist: curDist, lane, type: 'obstacle' });
    } else if (val < 0.7) {
      list.push({ dist: curDist, lane, type: 'jump_obstacle' });
    } else if (val < 0.85) {
      list.push({ dist: curDist, lane, type: 'duck_obstacle' });
    } else {
      // Double note
      list.push({ dist: curDist, lane, type: 'note' });
      list.push({ dist: curDist, lane: (lane + 1) % 3, type: 'note' });
    }
    curDist += Math.floor(rand.next() * 15) + 35;
  }
  return list;
};
