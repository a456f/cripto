// backend/scalpingStrategy.js

const SCALPING_PARAMS = {

    // micro dip para comprar barato
    DIP_PERCENT: 0.0004,      // 0.04%

    // ruptura de máximo
    BREAKOUT_PERCENT: 0.0003, // 0.03%

    // ganancia rápida
    TAKE_PROFIT_PERCENT: 0.0012, // 0.12%

    // protección rápida
    STOP_LOSS_PERCENT: 0.0009, // 0.09%

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
    const minLow = Math.min(...recent.map(c => c.low));

    const lastClose = history[history.length - 1].close;

    const momentumUp =
        candle.close > candle.open &&
        candle.close > lastClose;

    const volatility =
        (maxHigh - minLow) / maxHigh;

    // evita mercados muertos
    if (volatility < 0.0002) {
        return null;
    }

    const dipTrigger = maxHigh * (1 - SCALPING_PARAMS.DIP_PERCENT);
    const breakoutTrigger = maxHigh * (1 + SCALPING_PARAMS.BREAKOUT_PERCENT);


    // compra por dip
    if (candle.close <= dipTrigger && momentumUp) {

        log(`⚡ PRO BUY DIP → ${candle.close}`);

        return 'EXECUTE_BUY';
    }


    // compra por breakout
    if (candle.close >= breakoutTrigger && momentumUp) {

        log(`🚀 PRO BUY BREAKOUT → ${candle.close}`);

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

        log(`💰 PRO TAKE PROFIT → ${candle.close}`);

        return 'EXECUTE_SELL';
    }


    if (candle.close <= stopLoss) {

        log(`🛑 PRO STOP LOSS → ${candle.close}`);

        return 'EXECUTE_SELL';
    }

    return null;
}


module.exports = {

    evaluateScalpingBuy,
    evaluateScalpingSell

};