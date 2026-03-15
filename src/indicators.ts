// c:\Users\ANTHONY\Downloads\sistema_crip\src\indicators.ts
import type { Candle } from './marketData';

const average = (data: number[]) => data.reduce((sum, value) => sum + value, 0) / data.length;

export const calculateSMA = (data: Candle[], period: number): number | null => {
    if (data.length < period) return null;
    const closes = data.slice(0, period).map(c => c.close);
    return average(closes);
};

export const calculateRSI = (data: Candle[], period: number = 14): number | null => {
    if (data.length < period + 1) return null;
    
    // data comes in as [newest, ..., oldest]. Reverse to [oldest, ..., newest] for calculation
    const closes = data.map(c => c.close).reverse();

    let gains = 0;
    let losses = 0;

    // Initial average
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
            gains += diff;
        } else {
            losses -= diff;
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        let gain = 0;
        let loss = 0;
        if (diff >= 0) {
            gain = diff;
        } else {
            loss = -diff;
        }

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
        return 100;
    }

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
};

const calculateEMA = (data: number[], period: number): number[] => {
    const multiplier = 2 / (period + 1);
    const ema: number[] = [data[0]];
    for (let i = 1; i < data.length; i++) {
        const currentEma = (data[i] - ema[i - 1]) * multiplier + ema[i - 1];
        ema.push(currentEma);
    }
    return ema;
};

export interface MACDOutput {
    macd: number;
    signal: number;
    histogram: number;
}

export const calculateMACD = (
    data: Candle[],
    fastPeriod = 12,
    slowPeriod = 26,
    signalPeriod = 9
): MACDOutput | null => {
    const requiredLength = slowPeriod + signalPeriod;
    if (data.length < requiredLength) return null;

    const closes = data.map(c => c.close).reverse(); // Oldest to newest

    const emaFast = calculateEMA(closes, fastPeriod);
    const emaSlow = calculateEMA(closes, slowPeriod);

    const macdLine = emaFast.map((fast, index) => fast - emaSlow[index]);
    
    // We need valid MACD values to start calculating Signal
    const validMacdLine = macdLine.slice(slowPeriod - 1);

    if (validMacdLine.length < signalPeriod) return null;

    const signalLine = calculateEMA(macdLine, signalPeriod);

    const macd = macdLine[macdLine.length - 1];
    const signal = signalLine[signalLine.length - 1];
    const histogram = macd - signal;

    return { macd, signal, histogram };
};

export const calculateAverageVolume = (data: Candle[], period: number): number | null => {
    if (data.length < period) return null;
    const volumes = data.slice(0, period).map(c => c.volume);
    return average(volumes);
};
