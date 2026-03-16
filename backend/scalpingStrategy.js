// backend/scalpingStrategy.js

// --- Parámetros de la Estrategia de Scalping de Alta Frecuencia ---
// Estos parámetros están optimizados para una operativa muy activa, buscando
// capturar micro-movimientos del mercado.
const SCALPING_PARAMS = {
    // Porcentaje de caída desde el máximo reciente para activar una posible compra.
    // Un valor bajo (0.08%) busca "micro-dips".
    DIP_PERCENT: 0.0008, // 0.08%
    
    // Porcentaje de ganancia sobre el precio de compra para ejecutar la venta (Take Profit).
    // Un valor bajo (0.25%) asegura ventas rápidas.
    TAKE_PROFIT_PERCENT: 0.0025, // 0.25%

    // Período de velas de 1m para calcular el máximo reciente.
    // 5 minutos es un buen balance para reaccionar a la acción de precio inmediata.
    LOOKBACK_PERIOD: 5,
};

/**
 * Evalúa la señal de COMPRA para la estrategia de scalping de alta frecuencia.
 * Esta función se ejecuta en CADA TICK de precio para una reacción en milisegundos.
 *
 * Lógica de Compra:
 * 1. Identifica el precio más alto de los últimos 5 minutos (usando el historial de velas de 1m).
 * 2. Calcula un "precio gatillo" un 0.08% por debajo de ese máximo.
 * 3. Si el precio actual del tick cae por debajo de ese gatillo, la condición de "dip" se cumple.
 * 4. **Filtro de Confirmación**: Para evitar comprar mientras el precio sigue cayendo,
 *    se exige que la vela de 1 minuto actual sea alcista (precio de cierre > precio de apertura).
 *    Esto confirma un rebote inmediato y aumenta la probabilidad de éxito.
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

    // 1. Identificar el máximo reciente del historial.
    const recentCandles = history.slice(-SCALPING_PARAMS.LOOKBACK_PERIOD);
    const maxHigh = Math.max(...recentCandles.map(c => c.high));
    
    // 2. Calcular el precio de activación para la compra en el "micro-dip".
    const buyTriggerPrice = maxHigh * (1 - SCALPING_PARAMS.DIP_PERCENT);

    // --- CONDICIÓN DE COMPRA ---
    // a) ¿El precio actual ha caído al nivel del dip?
    const isPriceDip = candle.close <= buyTriggerPrice;
    // b) ¿Hay momentum de rebote inmediato (la vela de 1m actual es verde)?
    const hasMomentumConfirmation = candle.close > candle.open;

    if (isPriceDip && hasMomentumConfirmation) {
        log(`⚡️ SCALPING BUY: Dip con rebote detectado. Gatillo: <=${buyTriggerPrice.toFixed(2)}, Precio: ${candle.close.toFixed(2)}.`);
        return 'EXECUTE_BUY';
    }

    return null;
}

/**
 * Evalúa la señal de VENTA para la estrategia de scalping (Toma de Ganancias).
 * Esta función se ejecuta en CADA TICK de precio para una salida rápida.
 *
 * Lógica de Venta:
 * 1. Calcula el precio objetivo de Take Profit (precio de entrada + 0.25%).
 * 2. Si el precio actual del tick alcanza o supera ese objetivo, se ejecuta la venta.
 *
 * Nota: El Stop Loss es una red de seguridad universal gestionada por `botEngine.js`
 * y se aplica a todas las estrategias para proteger el capital.
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
