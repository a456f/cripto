// backend/scalpingStrategy.js

// --- Parámetros de la Estrategia de Scalping de Alta Frecuencia ---
// Parámetros optimizados para una operativa muy activa.
const SCALPING_PARAMS = {
    // % de caída desde el máximo reciente para buscar compras en "dips".
    DIP_PERCENT: 0.001, // 0.1%
    
    // % de subida sobre el máximo reciente para buscar compras en "rupturas".
    BREAKOUT_PERCENT: 0.0008, // 0.08%

    // % de ganancia sobre el precio de compra para tomar ganancias (Take Profit).
    TAKE_PROFIT_PERCENT: 0.003, // 0.3%

    // Cuántas velas de 1m hacia atrás mirar para establecer el rango de precios.
    LOOKBACK_PERIOD: 5,
};

/**
 * Evalúa la señal de COMPRA con una estrategia DUAL para que el bot nunca se quede parado.
 * Esta función se ejecuta en CADA TICK de precio para una reacción en milisegundos.
 *
 * Estrategia 1: Comprar en Dips (Reversión a la media).
 * Estrategia 2: Comprar en Rupturas (Momentum).
 * 
 * @param {object} state - El estado actual del bot (proporcionado por botEngine).
 * @param {object} candle - El tick de vela de 1m actual (datos en tiempo real).
 * @param {function} log - La función para registrar mensajes.
 * @returns {string|null} 'EXECUTE_BUY' si las condiciones se cumplen, de lo contrario null.
 */
function evaluateScalpingBuy(state, candle, log) {
    // Se necesita un historial mínimo de velas cerradas para poder calcular el máximo reciente.
    const history = state.candles1mHistory;
    if (history.length < SCALPING_PARAMS.LOOKBACK_PERIOD) {
        return null;
    }

    // --- Lógica de Referencia de Precio ---
    const recentCandles = history.slice(-SCALPING_PARAMS.LOOKBACK_PERIOD);
    const maxHigh = Math.max(...recentCandles.map(c => c.high));
    // Filtro clave: la vela de 1m actual debe mostrar momentum alcista.
    const hasMomentumConfirmation = candle.close > candle.open;
    
    // --- ESTRATEGIA 1: Comprar en Micro-Dips (Reversión a la media) ---
    const buyTriggerPrice = maxHigh * (1 - SCALPING_PARAMS.DIP_PERCENT);
    const isPriceDip = candle.close <= buyTriggerPrice;

    if (isPriceDip && hasMomentumConfirmation) {
        log(`⚡️ SCALPING BUY (DIP): Caída con rebote detectada. Gatillo: <=${buyTriggerPrice.toFixed(2)}, Precio: ${candle.close.toFixed(2)}.`);
        return 'EXECUTE_BUY';
    }

    // --- ESTRATEGIA 2: Comprar en Micro-Rupturas (Momentum) ---
    // Para mercados que suben sin hacer dips claros.
    const breakoutTriggerPrice = maxHigh * (1 + SCALPING_PARAMS.BREAKOUT_PERCENT);
    const isPriceBreakout = candle.close >= breakoutTriggerPrice;

    if (isPriceBreakout && hasMomentumConfirmation) {
        log(`🚀 SCALPING BUY (BREAKOUT): Ruptura de máximo reciente con momentum. Precio: ${candle.close.toFixed(2)} > Gatillo: ${breakoutTriggerPrice.toFixed(2)}.`);
        return 'EXECUTE_BUY';
    }

    return null;
}

/**
 * Evalúa la señal de VENTA para la estrategia de scalping (Toma de Ganancias).
 * Esta función se ejecuta en CADA TICK de precio para una salida rápida.
 * 
 * @param {object} state - El estado actual del bot, incluyendo la posición abierta.
 * @param {object} candle - El tick de vela de 1m actual.
 * @param {function} log - La función para registrar mensajes.
 * @returns {string|null} 'EXECUTE_SELL' si se alcanza el Take Profit, de lo contrario null.
 */
function evaluateScalpingSell(state, candle, log) {
    if (!state.position || !state.position.entryPrice) {
        return null;
    }

    const entryPrice = state.position.entryPrice;
    
    // --- CONDICIÓN DE VENTA (TAKE PROFIT) ---
    const takeProfitPrice = entryPrice * (1 + SCALPING_PARAMS.TAKE_PROFIT_PERCENT);

    if (candle.close >= takeProfitPrice) {
        log(`💰 SCALPING SELL (TAKE PROFIT): Precio ${candle.close.toFixed(2)} alcanzó objetivo de ${takeProfitPrice.toFixed(2)}.`);
        return 'EXECUTE_SELL';
    }

    return null;
}

module.exports = {
    evaluateScalpingBuy,
    evaluateScalpingSell,
};
