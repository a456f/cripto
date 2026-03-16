// backend/scalpingStrategy.js

const SCALPING_PARAMS = {

    DIP_PERCENT: 0.0015,
    BREAKOUT_PERCENT: 0.0005,

    TAKE_PROFIT_PERCENT: 0.003,
    STOP_LOSS_PERCENT: 0.002,

    TRAILING_PERCENT: 0.0015,

    LOOKBACK_PERIOD: 8
};


// ======================
// EMA SIMPLE
// ======================

function calculateEMA(history, period = 8) {

    if (history.length < period) return null;

    const closes = history.slice(-period).map(c => c.close);

    const avg =
        closes.reduce((a, b) => a + b, 0) / closes.length;

    return avg;
}


// ======================
// COMPRA
// ======================

function evaluateScalpingBuy(state, candle, log) {

    const history = state.candles1mHistory;

    if (history.length < SCALPING_PARAMS.LOOKBACK_PERIOD) {
        return null;
    }

    const recent = history.slice(-SCALPING_PARAMS.LOOKBACK_PERIOD);

    const maxHigh = Math.max(...recent.map(c => c.high));

    const dipTrigger =
        maxHigh * (1 - SCALPING_PARAMS.DIP_PERCENT);

    const ema = calculateEMA(history);

    if (!ema) return null;

    // filtro de tendencia
    if (candle.close < ema) {
        return null;
    }

    // evitar velas gigantes
    const candleMove =
        (candle.high - candle.low) / candle.low;

    if (candleMove > 0.003) {
        return null;
    }

    // BUY DIP REVERSAL
    if (
        candle.low <= dipTrigger &&
        candle.close > candle.open
    ) {

        log(`⚡ BUY DIP REVERSAL → ${candle.close}`);
        return 'EXECUTE_BUY';
    }

    // BUY BREAKOUT REAL
    if (
        candle.high > maxHigh &&
        candle.close > candle.open
    ) {

        log(`🚀 BUY REAL BREAKOUT → ${candle.close}`);
        return 'EXECUTE_BUY';
    }

    return null;
}


// ======================
// VENTA
// ======================

function evaluateScalpingSell(state, candle, log) {

    if (!state.position || !state.position.entryPrice) {
        return null;
    }

    const entry = state.position.entryPrice;

    const takeProfit =
        entry * (1 + SCALPING_PARAMS.TAKE_PROFIT_PERCENT);

    const stopLoss =
        entry * (1 - SCALPING_PARAMS.STOP_LOSS_PERCENT);

    // guardar máximo alcanzado
    if (!state.maxPrice || candle.high > state.maxPrice) {
        state.maxPrice = candle.high;
    }

    const trailingStop =
        state.maxPrice * (1 - SCALPING_PARAMS.TRAILING_PERCENT);

    // TAKE PROFIT
    if (candle.close >= takeProfit) {

        log(`💰 SELL TAKE PROFIT → ${candle.close}`);
        state.maxPrice = null;
        return 'EXECUTE_SELL';
    }

    // TRAILING PROFIT
    if (
        state.maxPrice &&
        candle.close <= trailingStop &&
        state.maxPrice > entry
    ) {

        log(`📉 SELL TRAILING PROFIT → ${candle.close}`);
        state.maxPrice = null;
        return 'EXECUTE_SELL';
    }

    // STOP LOSS
    if (candle.close <= stopLoss) {

        log(`🛑 SELL STOP LOSS → ${candle.close}`);
        state.maxPrice = null;
        return 'EXECUTE_SELL';
    }

    return null;
}


module.exports = {
    evaluateScalpingBuy,
    evaluateScalpingSell
};