// backend/botEngine.js
const WebSocket = require('ws');
const crypto = require('crypto');
const { getSignalForTimeframe, getFinalSignal } = require('./strategy');
const { evaluateScalpingBuy, evaluateScalpingSell } = require('./scalpingStrategy');

class BotEngine {
    constructor(apiKey, secretKey, passphrase) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.passphrase = passphrase;
        
        this.ws = null;
        this.pingInterval = null;
        this.reconnectTimeout = null;
        this.heartbeatInterval = null;
        
        this.state = {
            status: 'IDLE', // IDLE, ANALYZING, IN_POSITION
            tradeMode: 'balanced',
            candles: { '5m': [], '1h': [], '4h': [] },
            candles1mHistory: [], // Buffer persistente para estrategias de 1m
            currentPrice: 0,
            trailingStop: null,
            position: null, // { entryPrice, size, quantity }
            logs: []
        };

        this.config = {
            symbol: 'BTCUSDT',
            riskPercent: 0.1,
            stopLossPercent: 0.02
        };
    }

    async getAssets() {
        try {
            const res = await fetch('http://localhost:3001/api/bitget-assets');
            if (!res.ok) return [];
            const data = await res.json();
            if (data.code === '00000' && Array.isArray(data.data)) {
                return data.data;
            }
            return [];
        } catch (e) {
            this.log(`❌ Error obteniendo assets: ${e.message}`);
            return [];
        }
    }

    log(message) {
        const timeMsg = `[${new Date().toLocaleTimeString()}] ${message}`;
        console.log(timeMsg); // Mantenemos el log en la consola del servidor
        this.state.logs.unshift(timeMsg); // Añadimos al principio del array
        if (this.state.logs.length > 100) { // Evitamos que el array crezca indefinidamente
            this.state.logs.pop();
        }
    }

    async loadHistoricalData() {
        this.log("⏳ Cargando datos históricos de velas...");

        // --- LÓGICA EXCLUSIVA PARA MODO SCALPING ---
        // Si estamos en modo scalping, NO cargamos velas de 4h/1h. 
        // Solo necesitamos historial reciente de 1m para detectar máximos y mínimos.
        if (this.state.tradeMode === 'scalping') {
            try {
                const url = `http://localhost:3001/api/historical-candles?symbol=${this.config.symbol}&granularity=1min&limit=100`;
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                
                const data = await res.json();
                
                // Ordenamos por timestamp ascendente (más viejo -> más nuevo) para que coincida con el flujo del WebSocket .push()
                const candles = data.map(c => ({ 
                    timestamp: c[0], 
                    open: parseFloat(c[1]), 
                    high: parseFloat(c[2]), 
                    low: parseFloat(c[3]), 
                    close: parseFloat(c[4]), 
                    volume: parseFloat(c[5]) 
                })).sort((a, b) => parseInt(a.timestamp) - parseInt(b.timestamp));

                this.state.candles1mHistory = candles;
                this.log(`✅ [MODO SCALPING] ${candles.length} velas de 1m cargadas. Listo para operar inmediatamente.`);
            } catch (e) {
                this.log(`❌ Error cargando historial para Scalping: ${e.message}`);
            }
            return; // Salimos de la función aquí. No cargamos nada más.
        }

        // --- LÓGICA PARA MODOS DE TENDENCIA (Conservative, Balanced, Aggressive) ---
        const timeframes = {
            '5m': '5min',
            '1h': '1h',
            '4h': '4h'
        };
        let allLoaded = true;

        for (const [tf, granularity] of Object.entries(timeframes)) {
            try {
                // Re-route the request through the server's own API endpoint, which is known to work.
                // This centralizes external API calls and bypasses potential environment/network issues with direct fetch.
                const url = `http://localhost:3001/api/historical-candles?symbol=${this.config.symbol}&granularity=${granularity}&limit=200`;
                const res = await fetch(url);
                
                if (!res.ok) {
                    // Get the specific error message from our server's response
                    const errorData = await res.json().catch(() => ({ error: `Respuesta no válida del servidor (HTTP ${res.status})` }));
                    throw new Error(errorData.error || 'Error desconocido del servidor');
                }
                
                const data = await res.json();

                this.state.candles[tf] = data.map((c) => ({ 
                    timestamp: c[0], 
                    open: parseFloat(c[1]), 
                    high: parseFloat(c[2]), 
                    low: parseFloat(c[3]), 
                    close: parseFloat(c[4]), 
                    volume: parseFloat(c[5]) 
                }));
                this.log(`✅ ${this.state.candles[tf].length} velas de ${tf} cargadas.`);
            } catch (e) {
                // Add the timeframe to the error for better context
                this.log(`❌ Fallo al cargar velas de ${tf}: ${e.message}`); 
                allLoaded = false;
            }
        }
        if (allLoaded) {
            this.log("📈 Datos históricos cargados. El bot puede analizar inmediatamente.");
        } else {
            this.log("⚠️ No se pudieron cargar todos los datos históricos. El bot esperará a agregarlos en tiempo real.");
        }
    }

    async start(options = {}) {
        if (this.state.status === 'IDLE') {
            if (options.tradeMode) {
                this.state.tradeMode = options.tradeMode;
            }
            this.state.candles1mHistory = [];

            // Sincroniza el estado con el balance real del exchange antes de empezar
            await this.syncStateWithExchange();

            await this.loadHistoricalData();
            
            // Si después de sincronizar no estamos en posición, empezamos a analizar
            if (this.state.status !== 'IN_POSITION') {
                this.state.status = 'ANALYZING';
            }

            this.connectWebSocket();
            this.log(`🚀 [BOT ENGINE] Iniciado en modo ${this.state.tradeMode}. Estado actual: ${this.state.status}`);
            this.heartbeatInterval = setInterval(() => {
               this.log(`💓 BOT ALIVE | price: ${this.state.currentPrice}`)
            }, 60000);
        }
    }

    stop() {
        if (this.state.status === 'IN_POSITION') {
            this.log("⚠️ [BOT ENGINE] Detención solicitada pero hay una posición abierta. Cierre manual requerido.");
            return false;
        }
        this.state.status = 'IDLE';
        this.closeWebSocket();
        this.state.candles1mHistory = []; // Limpiar historial al parar
        clearInterval(this.heartbeatInterval);
        this.log("🛑 [BOT ENGINE] Detenido.");
        return true;
    }

    async panicStop() {
        this.log("🚨 [FRENO DE MANO] Detención de emergencia solicitada.");
        
        // 1. Si hay posición abierta, vender a mercado inmediatamente
        if (this.state.status === 'IN_POSITION') {
            this.log("📉 [FRENO DE MANO] Intentando cerrar posición a mercado...");
            // Forzamos venta inmediata ignorando lógica de estrategia
            await this.executeSell();
        }
        
        // 2. Forzar detención completa y limpieza
        this.state.status = 'IDLE';
        this.closeWebSocket();
        this.state.candles1mHistory = [];
        clearInterval(this.heartbeatInterval);
        this.log("🛑 [FRENO DE MANO] Bot detenido y desconectado correctamente.");
        return true;
    }

    async syncStateWithExchange() {
        this.log("🔄 Sincronizando estado con el balance del exchange...");
        try {
            const assets = await this.getAssets();
            const btc = assets.find(a => a.coin === 'BTC');
            const usdt = assets.find(a => a.coin === 'USDT');

            const availableBtc = btc ? parseFloat(btc.available) : 0;
            const availableUsdt = usdt ? parseFloat(usdt.available) : 0;

            // Necesitamos un precio para evaluar el valor de BTC
            const priceRes = await fetch(`http://localhost:3001/api/historical-candles?symbol=${this.config.symbol}&granularity=1min&limit=1`);
            const priceData = await priceRes.json();
            const currentPrice = parseFloat(priceData[0][4]);
            this.state.currentPrice = currentPrice;

            const btcValueUSD = availableBtc * currentPrice;

            this.log(`🏦 Balance detectado: ${availableUsdt.toFixed(2)} USDT, ${availableBtc.toFixed(8)} BTC (≈$${btcValueUSD.toFixed(2)})`);

            // Lógica de decisión: si tenemos más valor en BTC, asumimos que estamos en una posición.
            if (btcValueUSD > availableUsdt && btcValueUSD > 5.1) { // 5.1 es un umbral seguro sobre el mínimo de trade
                this.log("✅ Detectada posición existente en BTC. Iniciando en modo 'IN_POSITION' para buscar venta.");
                this.state.status = 'IN_POSITION';
                this.state.position = {
                    // No conocemos el precio de entrada real, así que lo asumimos como el actual para calcular PnL futuro.
                    entryPrice: currentPrice, 
                    size: btcValueUSD,
                    quantity: availableBtc,
                    highPrice: currentPrice // El Trailing Stop empieza desde aquí
                };
                this.state.trailingStop = currentPrice * (1 - this.config.stopLossPercent);
            } else {
                this.log("✅ Balance principal en USDT. Iniciando en modo 'ANALYZING' para buscar compra.");
                this.state.status = 'ANALYZING';
            }
        } catch (e) {
            this.log(`❌ Error sincronizando estado: ${e.message}. Iniciando en modo 'ANALYZING' por defecto.`);
            this.state.status = 'ANALYZING';
        }
    }

    connectWebSocket() {
        this.ws = new WebSocket('wss://ws.bitget.com/v2/ws/public');

        this.ws.on('open', () => {
            this.log('✅ [BOT ENGINE] WebSocket Conectado');
            const subscribeMsg = {
                op: 'subscribe',
                args: [{ instType: 'SPOT', channel: 'candle1m', instId: this.config.symbol }]
            };
            this.ws.send(JSON.stringify(subscribeMsg));
            
            this.pingInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) this.ws.send('ping');
            }, 20000);
        });

        this.ws.on('message', (data) => {
            if (data.toString() === 'pong') return;
            const msg = JSON.parse(data);
            if (msg.action === 'snapshot' || msg.action === 'update') {
                this.processCandleData(msg.data);
            }
        });

        this.ws.on('close', () => {
            this.log('⚠️ [BOT ENGINE] WebSocket desconectado. Reconectando...');
            clearInterval(this.pingInterval);
            this.reconnectTimeout = setTimeout(() => this.connectWebSocket(), 5000);
        });
        
        this.ws.on('error', (err) => this.log(`❌ [BOT ENGINE] Error WS: ${err.message}`));
    }

    closeWebSocket() {
        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }
        clearInterval(this.pingInterval);
        clearTimeout(this.reconnectTimeout);
    }

    processCandleData(dataList) {
        if (!Array.isArray(dataList) || dataList.length === 0) return;
        const raw = dataList[0];
        
        this.log(`DEBUG RAW: ${JSON.stringify(raw)}`);
        
        // The confirm flag is the last element. It can be a string '1' or number 1.
        const confirm = raw[raw.length - 1];
        const isCandleClosed = confirm === '1' || confirm === 1;

        const candle = {
            timestamp: raw[0],
            open: parseFloat(raw[1]),
            high: parseFloat(raw[2]),
            low: parseFloat(raw[3]),
            close: parseFloat(raw[4]),
            volume: parseFloat(raw[5])
        };

        this.log(`📡 Vela recibida 1m | precio: ${candle.close}`);
        this.state.currentPrice = candle.close;

        // --- Candle History Management (for all strategies) ---
        if (isCandleClosed) {
            this.log(`⏱ Vela 1m cerrada`);
            // Agrega para timeframes largos (5m, 1h, 4h)
            this.aggregateCandles(candle);
            
            // Mantiene historial de velas de 1m para scalping
            this.state.candles1mHistory.push(candle);
            if (this.state.candles1mHistory.length > 60) { // Mantiene la última hora
                this.state.candles1mHistory.shift();
            }
        }

        // --- ENRUTADOR DE ESTRATEGIAS ---
        if (this.state.tradeMode === 'scalping') {
            // SCALPING STRATEGY (High-Frequency, runs on every tick)
            if (this.state.status === 'ANALYZING') {
                const signal = evaluateScalpingBuy(this.state, candle, this.log.bind(this));
                if (signal === 'EXECUTE_BUY') {
                    this.executeBuy();
                }
            } else if (this.state.status === 'IN_POSITION') {
                const signal = evaluateScalpingSell(this.state, candle, this.log.bind(this));
                if (signal === 'EXECUTE_SELL') {
                    this.executeSell();
                }
            }
        } else { // Estrategias de Tendencia/Breakout
            if (this.state.status === 'ANALYZING') {
                // Real-time breakout detection (runs on every tick)
                this.detectRealtimeBreakout(candle);
                
                // Multi-timeframe analysis (runs only on 1m candle close)
                if (isCandleClosed) {
                    this.evaluateStrategy();
                }
            }
        }

        // --- GESTIÓN DE POSICIÓN UNIVERSAL (APLICA A TODAS LAS ESTRATEGIAS SI ESTÁ EN POSICIÓN) ---
        if (this.state.status === 'IN_POSITION') {
            // Siempre verifica el Stop Loss en cada tick para máxima seguridad
            this.checkStopLoss(candle);
            // Actualiza el Trailing Stop solo en velas cerradas para evitar movimientos erráticos
            if (isCandleClosed) {
                this.updateTrailingStop(candle);
            }
        }
    }

    evaluateStrategy() {
        this.log("📊 Analizando mercado...");

        // Validar que tenemos suficientes datos
        if (this.state.candles['4h'].length < 50) {
            this.log("⚠️ No hay suficientes velas para analizar");
            return;
        }

        const signals = {
            '4h': getSignalForTimeframe(this.state.candles['4h']),
            '1h': getSignalForTimeframe(this.state.candles['1h']),
            '5m': getSignalForTimeframe(this.state.candles['5m'])
        };

        const finalSignal = getFinalSignal(signals, this.state.tradeMode);

        this.log(`📊 ANALISIS → 4h:${signals['4h'].timeframeBias} | 1h:${signals['1h'].timeframeBias} | 5m:${signals['5m'].timeframeBias} | FINAL:${finalSignal}`);
        this.log(`📊 Resultado: ${finalSignal}`);

        // detector de ruptura con volumen
        const candles5m = this.state.candles['5m'];

        if (candles5m.length > 10) {

            const last = candles5m[0];
            const prev = candles5m[1];

            const avgVolume =
                candles5m.slice(1,6).reduce((a,c)=>a+c.volume,0) / 5;

            // Lógica de breakout mejorada para cierre de vela
            const breakout =
                last.close > prev.high &&
                last.close > last.open && // Vela alcista
                last.volume > avgVolume * 1.2 && // Volumen más flexible
                signals['1h'].timeframeBias === 'BULLISH'; // Confirmación de tendencia mayor

            if (breakout) {
                this.log("🚀 BREAKOUT (cierre de vela) detectado con volumen y confirmación");
                this.executeBuy();
                return;
            }
        }

        if (finalSignal === 'EXECUTE_LONG') {
            this.executeBuy();
        }

        if (finalSignal !== 'EXECUTE_LONG') {
            this.log("❌ No hay señal de compra");
        }
    }

    detectRealtimeBreakout(candle) {
        // Evita compras repetidas si ya está en una posición o en proceso de compra
        if (this.state.status !== 'ANALYZING') return;

        const candles5m = this.state.candles['5m'];
        // Necesitamos al menos una vela de 5m completamente cerrada para obtener su máximo
        if (candles5m.length < 2) return;

        const prev5m = candles5m[1]; // La vela de 5m anterior, ya cerrada.

        // Condición de breakout en tiempo real:
        // 1. El precio actual del tick supera el máximo de la vela de 5m anterior.
        // 2. La vela de 1m actual es alcista (cierre > apertura) para confirmar momentum.
        if (
            candle.close > prev5m.high &&
            candle.close > candle.open
        ) {
            this.log(`⚡ BREAKOUT (tiempo real) detectado en ${candle.close} (superando máximo anterior de ${prev5m.high})`);
            this.executeBuy();
        }
    }

    async executeBuy() {
        // Prevenir compras múltiples si ya hay una en curso o una posición abierta
        if (this.state.status !== 'ANALYZING') return;
        if (this.state.position) return; // Ya en posición

        this.state.status = 'BUYING'; // Bloquear estado para evitar compras concurrentes
        this.log("🎯 [BOT ENGINE] Señal de COMPRA detectada. Verificando balance y ejecutando...");

        try {
            // Lógica de Rotación: Usar todo el balance de USDT disponible.
            const assets = await this.getAssets();
            const usdt = assets.find(a => a.coin === 'USDT');
            const availableUsdt = usdt ? parseFloat(usdt.available) : 0;

            // El mínimo de Bitget es ~5 USDT. Usamos un buffer.
            if (availableUsdt < 5.1) {
                this.log(`⚠️ Compra cancelada. Balance USDT insuficiente (${availableUsdt.toFixed(2)}). Se necesita > 5.1 USDT.`);
                this.state.status = 'ANALYZING'; // Volver a analizar
                return;
            }

            // Usar el balance completo para la compra.
            const sizeUSDT = availableUsdt * 0.97;
            this.log(`💸 Usando balance completo: ${sizeUSDT.toFixed(2)} USDT para la compra.`);

            const res = await fetch("http://localhost:3001/api/place-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    side: "buy",
                    // Enviamos el tamaño con 2 decimales de precisión.
                    size: sizeUSDT.toFixed(2) 
                })
            });

            const data = await res.json();

            if (data.code !== "00000") {
                this.log(`❌ Error ejecutando compra: ${data.msg}`);
                this.state.status = 'ANALYZING'; // Revertir estado si la orden falla
                return;
            }

            const entry = this.state.currentPrice;

            this.state.status = 'IN_POSITION';

            this.state.position = {
                entryPrice: entry,
                size: sizeUSDT,
                quantity: Number((sizeUSDT / entry).toFixed(8)), // Mayor precisión para crypto
                highPrice: entry
            };

            this.state.trailingStop = entry * (1 - this.config.stopLossPercent);

            this.log(`✅ COMPRA REAL EJECUTADA en ${entry}`);

        } catch (err) {

            this.log(`❌ Error crítico enviando orden BUY: ${err.message}`);
            this.state.status = 'ANALYZING'; // Revertir estado si hay error de red
            this.state.position = null; // Asegurarse de que no haya posición fantasma
        }
    }

    // Checks on every price tick if the stop loss has been hit.
    checkStopLoss(candle) {
        if (!this.state.position || !this.state.trailingStop) return;

        if (candle.close <= this.state.trailingStop) {
            this.log(`📉 Stop Loss alcanzado en ${this.state.trailingStop.toFixed(2)}. Vendiendo...`);
            this.executeSell();
        }
    }

    // Updates the trailing stop based on new highs. Only runs on closed candles.
    updateTrailingStop(closedCandle) {
        if (!this.state.position || !this.state.trailingStop) return;

        // Update the highest price seen during the trade
        const highPriceSinceEntry = Math.max(this.state.position.highPrice || this.state.position.entryPrice, closedCandle.high);

        if (highPriceSinceEntry > this.state.position.highPrice) {
            this.state.position.highPrice = highPriceSinceEntry;
            const newStop = this.state.position.highPrice * (1 - this.config.stopLossPercent);
            
            if (newStop > this.state.trailingStop) {
                this.state.trailingStop = newStop;
                this.log(`📈 Trailing Stop actualizado: ${newStop.toFixed(2)}`);
            }
        }
    }

    async executeSell() {

        if (!this.state.position) {
            this.log("⚠️ Intento de venta sin posición registrada. Ignorando.");
            return;
        }

        try {
            // Lógica de Rotación: Vender todo el balance de BTC disponible.
            const assets = await this.getAssets();
            const btc = assets.find(a => a.coin === 'BTC');
            const availableBtc = btc ? parseFloat(btc.available) : 0;

            if (availableBtc <= 0.00001) { // Umbral mínimo para evitar vender polvo
                this.log(`ℹ️ Venta omitida. No hay suficiente BTC para vender (${availableBtc}). Reseteando estado.`);
            } else {
                this.log(`💸 Vendiendo todo el balance de BTC: ${availableBtc.toFixed(8)} BTC.`);
                const quantity = availableBtc;

            const res = await fetch("http://localhost:3001/api/place-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    side: "sell",
                    size: quantity.toFixed(6) // Usar alta precisión para cantidad de crypto
                })
            });

            const data = await res.json();

            if (data.code !== "00000") {
                this.log(`❌ Error ejecutando venta: ${data.msg}`);
                // No reseteamos el estado aquí, para que pueda reintentar la venta en el siguiente tick.
                return; 
            }

            this.log("💸 VENTA REAL EJECUTADA");
            }

            this.state.status = "ANALYZING";
            this.state.position = null;
            this.state.trailingStop = null;

        } catch (err) {

            this.log(`❌ Error enviando orden SELL: ${err.message}`);

        }
    }
    
    // Método para inyectar datos históricos al iniciar
    setHistoricalData(data) {
        this.state.candles = data;
    }
    
    getStatus() {
        const statusPayload = {
            status: this.state.status,
            tradeMode: this.state.tradeMode,
            currentPrice: this.state.currentPrice,
            position: this.state.position,
            trailingStop: this.state.trailingStop,
            logs: this.state.logs,
            unrealizedPnl: { percent: 0, usdt: 0 }
        };

        if (this.state.status === 'IN_POSITION' && this.state.position && this.state.position.entryPrice > 0) {
            const pnlPercent = ((this.state.currentPrice - this.state.position.entryPrice) / this.state.position.entryPrice) * 100;
            const pnlUsdt = (this.state.currentPrice - this.state.position.entryPrice) * this.state.position.quantity;
            statusPayload.unrealizedPnl = {
                percent: pnlPercent,
                usdt: pnlUsdt
            };
        }
        return statusPayload;
    }
}

module.exports = BotEngine;
