import type { Candle } from './marketData';
import type { Trend } from './strategy';

export type Signal = 'LONG_ENTRY' | 'WAITING' | null;

export const detectSignal = (
  trend: Trend,
  currentPrice: number,
  lastClosedCandle: Candle
): Signal => {

  // Solo operamos si la tendencia es alcista
  if (trend !== 'BULLISH') return null;

  /*
  Pullback inteligente
  Antes usabas 0.999 (0.1%) que era demasiado estricto.
  Ahora usamos 0.9998 (~0.02%) para detectar retrocesos pequeños
  que son comunes en tendencias fuertes.
  */
  const isPullback = currentPrice < lastClosedCandle.high * 0.9998;

  /*
  Confirmación de estructura:
  El precio debe mantenerse encima del mínimo de la vela anterior.
  Si rompe ese mínimo, la estructura alcista se rompe.
  */
  const isRespectingSupport = currentPrice > lastClosedCandle.low;

  /*
  Confirmación de reentrada:
  Queremos que el precio empiece a recuperarse después del pullback.
  */
  const isReversal = currentPrice > lastClosedCandle.close;

  if (isPullback && isRespectingSupport && isReversal) {
    return 'LONG_ENTRY';
  }

  return 'WAITING';
};