// c:\Users\ANTHONY\Downloads\sistema_crip\src\signals.ts

import type { TimeframeAnalysis } from './strategy';

export type TimeframeSignals = Record<'5m' | '1h' | '4h', TimeframeAnalysis>;

export type FinalSignal = 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'WAIT';

/**
 * Determines the final trading signal based on a multi-timeframe hierarchy.
 * @param signals - The analysis results for 5m, 1h, and 4h timeframes.
 * @param tradeMode - The current trading mode which affects score thresholds.
 * @returns The final trading signal.
 */
export const getFinalSignal = (
  signals: TimeframeSignals,
  tradeMode: 'conservative' | 'balanced' | 'aggressive'
): FinalSignal => {
  const { '4h': fourHour, '1h': oneHour, '5m': fiveMin } = signals;

  const scoreThreshold = {
    conservative: 4,
    balanced: 3,
    aggressive: 2,
  }[tradeMode];

  // Volatility Filter on 5m timeframe
  // ATR should be at least 0.05% of the current price. This can be tuned.
  const atrThreshold = fiveMin.close * 0.0005; 
  if (fiveMin.atr > 0 && fiveMin.atr < atrThreshold) {
      return 'WAIT'; // ATR is too low, avoid trading
  }

  // LONG condition
  if (
    fourHour.timeframeBias === 'BULLISH' &&
    oneHour.timeframeBias !== 'BEARISH' &&
    fiveMin.score >= scoreThreshold
  ) {
    return 'EXECUTE_LONG';
  }

  // SHORT condition (for spot, this would mean selling assets)
  if (
    fourHour.timeframeBias === 'BEARISH' &&
    oneHour.timeframeBias !== 'BULLISH' &&
    fiveMin.score <= -scoreThreshold
  ) {
    return 'EXECUTE_SHORT';
  }

  return 'WAIT';
};