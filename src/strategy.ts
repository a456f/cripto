// c:\Users\ANTHONY\Downloads\sistema_crip\src\strategy.ts
import type { Candle } from './marketData';

export type Trend = 'BULLISH' | 'BEARISH' | 'LATERAL';
export type MarketPhase = 'ACCUMULATION' | 'TREND' | 'DISTRIBUTION';

export interface MarketStructure {
  trend: Trend;
  phase: MarketPhase;
  lastHH: number;
  lastHL: number;
  volumeConfirmed: boolean;
}

export const analyzeTrend = (history: Candle[]): MarketStructure => {
  if (history.length < 15) {
    return { trend: 'LATERAL', phase: 'ACCUMULATION', lastHH: 0, lastHL: 0, volumeConfirmed: false };
  }

  // 1. Identificar Pivotes (Simplificado para 1m)
  const highs = history.map(c => c.high);
  const lows = history.map(c => c.low);
  const volumes = history.map(c => c.volume);

  const currentHigh = Math.max(...highs.slice(0, 5));
  const prevHigh = Math.max(...highs.slice(5, 10));
  const currentLow = Math.min(...lows.slice(0, 5));
  const prevLow = Math.min(...lows.slice(5, 10));

  // 2. Confirmación de Volumen
  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const recentVolume = volumes.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
  const volumeConfirmed = recentVolume > avgVolume;

  // 3. Estructura de Tendencia
  let trend: Trend = 'LATERAL';
  if (currentHigh > prevHigh && currentLow > prevLow) trend = 'BULLISH';
  else if (currentHigh < prevHigh && currentLow < prevLow) trend = 'BEARISH';

  // 4. Identificación de Fases (Lógica Wyckoff simplificada)
  let phase: MarketPhase = 'ACCUMULATION';
  if (trend === 'BULLISH') phase = 'TREND';
  else if (currentHigh <= prevHigh && volumeConfirmed) phase = 'DISTRIBUTION';

  return { trend, phase, lastHH: currentHigh, lastHL: currentLow, volumeConfirmed };
};
