// c:\Users\ANTHONY\Downloads\sistema_crip\src\signals.ts
import type { Candle } from './marketData';
import type { TimeframeSignal } from './strategy';

export type FinalSignal = 'EXECUTE_LONG' | 'EXECUTE_SHORT' | 'WAIT';

export interface TimeframeSignals {
    '5m': TimeframeSignal;
    '1h': TimeframeSignal;
    '4h': TimeframeSignal;
}

export const getFinalSignal = (signals: TimeframeSignals): FinalSignal => {
    if (signals['4h'] === 'LONG' && signals['1h'] === 'LONG' && signals['5m'] === 'LONG') {
        return 'EXECUTE_LONG';
    }
    if (signals['4h'] === 'SHORT' && signals['1h'] === 'SHORT' && signals['5m'] === 'SHORT') {
        return 'EXECUTE_SHORT';
    }
    return 'WAIT';
};