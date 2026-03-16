// backend/scalpingStrategy.js

// --- Parámetros de la Estrategia de Scalping ---
// Centralizar los parámetros aquí facilita su ajuste y mejora la legibilidad. Estos son los "ajustes finos" del motor.
const SCALPING_PARAMS = {
    // Porcentaje de caída desde el máximo reciente para considerar una "compra barata".
    DIP_PERCENT: 0.002, // 0.2%
    
    // Porcentaje de ganancia desde el precio de entrada para tomar ganancias.
    TAKE_PROFIT_PERCENT: 0.006, // 0.6% - Un poco más alto para cubrir fees y asegurar ganancia.

    // Cuántas velas de 1m hacia atrás mirar para encontrar el máximo reciente.
    LOOKBACK_PERIOD: 5,

    // Cuántas velas de 1m hacia atrás mirar para calcular el volumen promedio.
    VOLUME_LOOKBACK: 10,

    // Multiplicador para confirmar que el volumen actual es significativo.
    // Un valor de 1.2 significa que el volumen debe ser un 20% superior al promedio.
    VOLUME_MULTIPLIER: 1.5, // Más estricto para buscar picos de volumen más claros.
};

/**
 * Evalúa si hay una señal de compra para la estrategia de scalping de alta frecuencia.
 * Lógica Mejorada:
 * 1. Busca una pequeña caída de precio (dip) desde un máximo reciente.
 * 2. Confirma que el tick actual tiene un volumen superior al promedio para validar el interés del mercado.
 * 3. Confirma que la vela de 1 minuto actual muestra un rebote (el precio actual es mayor que su apertura).
 * 
 * @param {object} state - El estado actual del bot, incluyendo el historial de velas.
 * @param {object} candle - El tick de vela de 1m más reciente.
 * @param {function} log - La función para registrar mensajes.
 * @returns {string|null} 'EXECUTE_BUY' si las condiciones se cumplen, de lo contrario null.
 */
function evaluateScalpingBuy(state, candle, log) {    
    // Se necesita un historial mínimo de velas cerradas para poder calcular promedios y máximos.
    const history = state.candles1mHistory;
    if (history.length < Math.max(SCALPING_PARAMS.LOOKBACK_PERIOD, SCALPING_PARAMS.VOLUME_LOOKBACK)) {
        return null;
    }

    // 1. Identificar el máximo reciente usando el historial de velas cerradas.
    const recentCandles = history.slice(-SCALPING_PARAMS.LOOKBACK_PERIOD);
    const maxHigh = Math.max(...recentCandles.map(c => c.high));
    
    // 2. Calcular el precio de activación para la compra en el "dip".
    const buyTriggerPrice = maxHigh * (1 - SCALPING_PARAMS.DIP_PERCENT);

    // 3. Calcular el volumen promedio reciente del historial para usarlo como filtro.
    const volumeCandles = history.slice(-SCALPING_PARAMS.VOLUME_LOOKBACK);
    const avgVolume = volumeCandles.reduce((acc, c) => acc + c.volume, 0) / volumeCandles.length;
    
    // --- CONDICIÓN DE COMPRA ---
    // a) El precio actual ha caído por debajo del gatillo.
    const isPriceDip = candle.close <= buyTriggerPrice;
    // b) El volumen del tick actual es significativamente mayor que el promedio.
    const hasVolumeConfirmation = candle.volume > (avgVolume * SCALPING_PARAMS.VOLUME_MULTIPLIER);
    // c) La vela de 1m actual es verde, confirmando un rebote/momentum alcista inmediato.
    const hasMomentumConfirmation = candle.close > candle.open;

    if (isPriceDip && hasVolumeConfirmation && hasMomentumConfirmation) {
        log(`⚡️ SCALPING BUY: Dip con rebote y volumen. Gatillo: <=${buyTriggerPrice.toFixed(2)}, Precio: ${candle.close.toFixed(2)}, Volumen: ${candle.volume.toFixed(0)} > Promedio: ${avgVolume.toFixed(0)}.`);
        return 'EXECUTE_BUY';
    }
    return null;
}

/**
 * Evalúa si hay una señal de venta para la estrategia de scalping (Take Profit).
 * La lógica de Stop Loss es universal y se gestiona en `botEngine.js` para máxima seguridad.
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
