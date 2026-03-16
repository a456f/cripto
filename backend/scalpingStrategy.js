// backend/scalpingStrategy.js

const SCALPING_PARAMS = {

    DIP_PERCENT: 0.00015,      // 0.015%
    BREAKOUT_PERCENT: 0.00015, // 0.015%

    TAKE_PROFIT_PERCENT: 0.0006, // 0.06%
    STOP_LOSS_PERCENT: 0.0005,   // 0.05%

    LOOKBACK_PERIOD: 4
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
    const minLow = Math.min(...recent.map(c => c.low));

    const dipTrigger = maxHigh * (1 - SCALPING_PARAMS.DIP_PERCENT);
    const breakoutTrigger = maxHigh * (1 + SCALPING_PARAMS.BREAKOUT_PERCENT);

    const momentumUp =
        candle.close > candle.open;

    // comprar en micro dip
    if (candle.close <= dipTrigger && momentumUp) {

        log(`⚡ MICRO BUY DIP → ${candle.close}`);
        return 'EXECUTE_BUY';
    }

    // comprar en micro breakout
    if (candle.close >= breakoutTrigger && momentumUp) {

        log(`🚀 MICRO BUY BREAKOUT → ${candle.close}`);
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

        log(`💰 MICRO TAKE PROFIT → ${candle.close}`);
        return 'EXECUTE_SELL';
    }

    if (candle.close <= stopLoss) {

        log(`🛑 MICRO STOP LOSS → ${candle.close}`);
        return 'EXECUTE_SELL';
    }

    return null;
}


module.exports = {
    evaluateScalpingBuy,
    evaluateScalpingSell
};