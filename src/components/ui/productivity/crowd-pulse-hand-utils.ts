export type HandLandmark = {
  x: number;
  y: number;
  z?: number;
};

export type HandMetrics = {
  handCount: number;
  openHands: number;
  totalHands: number;
  confidence: number;
  noiseLevel: number;
};

const FINGER_TIPS = [8, 12, 16, 20];
const FINGER_PIPS = [6, 10, 14, 18];

export const countExtendedFingers = (landmarks: HandLandmark[]) => {
  let count = 0;
  for (let i = 0; i < FINGER_TIPS.length; i += 1) {
    const tip = landmarks[FINGER_TIPS[i]];
    const pip = landmarks[FINGER_PIPS[i]];
    if (!tip || !pip) continue;
    if (tip.y < pip.y) count += 1;
  }
  return count;
};

export const isOpenPalm = (landmarks: HandLandmark[]) => countExtendedFingers(landmarks) >= 4;

export const computeCrowdMetrics = (
  landmarksList: HandLandmark[][],
  handednessScores?: Array<Array<{ score?: number }>>,
): HandMetrics => {
  const totalHands = Array.isArray(landmarksList) ? landmarksList.length : 0;
  let openHands = 0;
  let scoreTotal = 0;
  let scoreCount = 0;

  for (let i = 0; i < totalHands; i += 1) {
    const landmarks = landmarksList[i];
    if (!Array.isArray(landmarks)) continue;
    if (isOpenPalm(landmarks)) {
      openHands += 1;
      const score = handednessScores?.[i]?.[0]?.score;
      if (typeof score === 'number') {
        scoreTotal += score;
        scoreCount += 1;
      }
    }
  }

  const confidence = scoreCount > 0 ? Math.min(1, Math.max(0, scoreTotal / scoreCount)) : 0;
  const noiseLevel = totalHands > 0 ? Math.min(1, Math.max(0, 1 - openHands / totalHands)) : 0;

  return {
    handCount: openHands,
    openHands,
    totalHands,
    confidence,
    noiseLevel,
  };
};
