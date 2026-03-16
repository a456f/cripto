// backend/scalpingStrategy.js

const SCALPING_PARAMS = {

    DIP_PERCENT: 0.0001,      // 0.01%

    BREAKOUT_PERCENT: 0.0001, // 0.01%

    TAKE_PROFIT_PERCENT: 0.0015, // 0.15%

    STOP_LOSS_PERCENT: 0.001,   // 0.10%

    LOOKBACK_PERIOD: 3
};


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

    const dipTrigger = maxHigh * (1 - SCALPING_PARAMS.DIP_PERCENT);
    const breakoutTrigger = maxHigh * (1 + SCALPING_PARAMS.BREAKOUT_PERCENT);

    // comprar en micro movimiento
    if (candle.close <= dipTrigger) {

        log(`⚡ BUY MICRO DIP → ${candle.close}`);
        return 'EXECUTE_BUY';
    }

    if (candle.close >= breakoutTrigger) {

        log(`🚀 BUY MICRO BREAKOUT → ${candle.close}`);
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

    const takeProfit = entry * (1 + SCALPING_PARAMS.TAKE_PROFIT_PERCENT);
    const stopLoss = entry * (1 - SCALPING_PARAMS.STOP_LOSS_PERCENT);

    if (candle.close >= takeProfit) {

        log(`💰 SELL QUICK PROFIT → ${candle.close}`);
        return 'EXECUTE_SELL';
    }

    if (candle.close <= stopLoss) {

        log(`🛑 SELL QUICK STOP → ${candle.close}`);
        return 'EXECUTE_SELL';
    }

    return null;
}

module.exports = {
    evaluateScalpingBuy,
    evaluateScalpingSell
};