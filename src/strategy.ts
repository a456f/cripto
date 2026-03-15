// c:\Users\ANTHONY\Downloads\sistema_crip\src\strategy.ts
import type { Candle } from './marketData';
import { calculateSMA, calculateRSI, calculateMACD, calculateAverageVolume } from './indicators';

export type TimeframeSignal = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface TimeframeAnalysis {
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    volume: 'CONFIRMATION' | 'NO_CONFIRMATION';
    sma: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rsi: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    macd: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    finalSignal: TimeframeSignal;
}

export const getSignalForTimeframe = (candles: Candle[]): TimeframeAnalysis => {
    const emptyAnalysis: TimeframeAnalysis = {
        trend: 'NEUTRAL',
        volume: 'NO_CONFIRMATION',
        sma: 'NEUTRAL',
        rsi: 'NEUTRAL',
        macd: 'NEUTRAL',
        finalSignal: 'NEUTRAL',
    };

    if (candles.length < 100) { // Need enough data for SMA100
        return emptyAnalysis;
    }

    const [currentCandle, prevCandle1, prevCandle2] = candles;

    // 1. Trend
    let trend: TimeframeAnalysis['trend'] = 'NEUTRAL';
    if (
        currentCandle.high > prevCandle1.high && prevCandle1.high > prevCandle2.high &&
        currentCandle.low > prevCandle1.low && prevCandle1.low > prevCandle2.low
    ) {
        trend = 'BULLISH';
    } else if (
        currentCandle.high < prevCandle1.high && prevCandle1.high < prevCandle2.high &&
        currentCandle.low < prevCandle1.low && prevCandle1.low < prevCandle2.low
    ) {
        trend = 'BEARISH';
    }

    // 2. Volume
    const avgVolume = calculateAverageVolume(candles.slice(1), 10); // Avg of last 10 closed candles
    const volume: TimeframeAnalysis['volume'] =
        avgVolume && currentCandle.volume > avgVolume * 1.5 ? 'CONFIRMATION' : 'NO_CONFIRMATION';

    // 3. SMA
    const sma50 = calculateSMA(candles, 50);
    const sma100 = calculateSMA(candles, 100);
    let sma: TimeframeAnalysis['sma'] = 'NEUTRAL';
    if (sma50 && sma100) {
        if (sma50 > sma100 && currentCandle.close > sma50) {
            sma = 'BULLISH';
        } else if (sma50 < sma100 && currentCandle.close < sma50) {
            sma = 'BEARISH';
        }
    }

    // 4. RSI
    const rsiValue = calculateRSI(candles, 14);
    let rsi: TimeframeAnalysis['rsi'] = 'NEUTRAL';
    if (rsiValue) {
        if (rsiValue < 30) rsi = 'BULLISH';
        if (rsiValue > 70) rsi = 'BEARISH';
    }

    // 5. MACD
    const macdValue = calculateMACD(candles, 12, 26, 9);
    let macd: TimeframeAnalysis['macd'] = 'NEUTRAL';
    if (macdValue) {
        if (macdValue.macd > macdValue.signal && macdValue.macd > 0) {
            macd = 'BULLISH';
        } else if (macdValue.macd < macdValue.signal && macdValue.macd < 0) {
            macd = 'BEARISH';
        }
    }

    // Final Signal for timeframe
    let finalSignal: TimeframeSignal = 'NEUTRAL';
    if (
        trend === 'BULLISH' && volume === 'CONFIRMATION' && sma === 'BULLISH' &&
        rsi === 'BULLISH' && macd === 'BULLISH'
    ) {
        finalSignal = 'LONG';
    } else if (
        trend === 'BEARISH' && volume === 'CONFIRMATION' && sma === 'BEARISH' &&
        rsi === 'BEARISH' && macd === 'BEARISH'
    ) {
        finalSignal = 'SHORT';
    }

    return { trend, volume, sma, rsi, macd, finalSignal };
};
