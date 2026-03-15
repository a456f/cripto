// backend/botEngine.js
const WebSocket = require('ws');
const crypto = require('crypto');
const { getSignalForTimeframe, getFinalSignal } = require('./strategy');

class BotEngine {
    constructor(apiKey, secretKey, passphrase) {
        this.apiKey = apiKey;
        this.secretKey = secretKey;
        this.passphrase = passphrase;
        
        this.ws = null;
        this.pingInterval = null;
        this.reconnectTimeout = null;
        
        this.state = {
            status: 'IDLE', // IDLE, ANALYZING, IN_POSITION
            tradeMode: 'balanced',
            candles: { '5m': [], '1h': [], '4h': [] },
            candles1m: [], // Buffer para agregación
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
            await this.loadHistoricalData();
            this.state.status = 'ANALYZING';
            this.connectWebSocket();
            this.log(`🚀 [BOT ENGINE] Iniciado en modo ${this.state.tradeMode}. Analizando mercado...`);
        }
    }

    stop() {
        if (this.state.status === 'IN_POSITION') {
            this.log("⚠️ [BOT ENGINE] Detención solicitada pero hay una posición abierta. Cierre manual requerido.");
            return false;
        }
        this.state.status = 'IDLE';
        this.closeWebSocket();
        this.log("🛑 [BOT ENGINE] Detenido.");
        return true;
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
        const candle = {
            timestamp: raw[0],
            open: parseFloat(raw[1]),
            high: parseFloat(raw[2]),
            low: parseFloat(raw[3]),
            close: parseFloat(raw[4]),
            volume: parseFloat(raw[5])
        };

        this.state.currentPrice = candle.close;
        this.aggregateCandles(candle);
        
        // Ejecutar lógica principal
        if (this.state.status === 'ANALYZING') {
            this.evaluateStrategy();
        } else if (this.state.status === 'IN_POSITION') {
            this.managePosition(candle);
        }
    }

    aggregateCandles(new1mCandle) {
        // Lógica simplificada de agregación (debería ser más robusta para producción)
        // Aquí asumimos que tenemos datos históricos cargados previamente (ver loadHistorical en server.js)
        const timeframes = { '5m': 5, '1h': 60, '4h': 240 };
        
        for (const [tf, minutes] of Object.entries(timeframes)) {
            const candleArray = this.state.candles[tf];
            const interval = minutes * 60 * 1000;
            const candleTime = parseInt(new1mCandle.timestamp);
            const candleTimestamp = Math.floor(candleTime / interval) * interval;

            if (candleArray.length > 0 && candleArray[0].timestamp == candleTimestamp.toString()) {
                // Actualizar vela actual
                candleArray[0].high = Math.max(candleArray[0].high, new1mCandle.high);
                candleArray[0].low = Math.min(candleArray[0].low, new1mCandle.low);
                candleArray[0].close = new1mCandle.close;
                candleArray[0].volume += new1mCandle.volume;
            } else {
                // Nueva vela
                const newTfCandle = { ...new1mCandle, timestamp: candleTimestamp.toString() };
                candleArray.unshift(newTfCandle);
                if (candleArray.length > 200) candleArray.pop();
            }
        }
    }

    evaluateStrategy() {
        // Validar que tenemos suficientes datos
        if (this.state.candles['4h'].length < 50) return;

        const signals = {
            '4h': getSignalForTimeframe(this.state.candles['4h']),
            '1h': getSignalForTimeframe(this.state.candles['1h']),
            '5m': getSignalForTimeframe(this.state.candles['5m'])
        };

        const finalSignal = getFinalSignal(signals, this.state.tradeMode);
        
        // Log ligero para monitoreo (solo cada cambio de vela 5m o señal fuerte)
        // ...

        if (finalSignal === 'EXECUTE_LONG') {
            this.executeBuy();
        }
    }

    async executeBuy() {
        this.log("🎯 [BOT ENGINE] Señal de COMPRA detectada. Ejecutando...");
        // 1. Calcular tamaño (simulado aquí, deberías llamar a tu API de balance)
        // 2. Ejecutar orden
        // 3. Actualizar estado a IN_POSITION
        // Nota: Aquí llamarías a this.placeOrder(...) 
        this.state.status = 'IN_POSITION';
        this.state.position = { 
            entryPrice: this.state.currentPrice, 
            quantity: 0.001, // Ejemplo
            size: 20, // Ejemplo
            highPrice: this.state.currentPrice
        };
        this.state.trailingStop = this.state.currentPrice * (1 - this.config.stopLossPercent);
        this.log(`✅ COMPRA EJECUTADA. Posición abierta en ${this.state.position.entryPrice}. Stop Loss inicial en ${this.state.trailingStop.toFixed(2)}`);
    }

    managePosition(candle) {
        if (!this.state.position || !this.state.trailingStop) return;

        // Lógica de Trailing Stop
        this.state.position.highPrice = Math.max(this.state.position.highPrice || this.state.position.entryPrice, candle.high);
        const newStop = this.state.position.highPrice * (1 - this.config.stopLossPercent);
        
        if (newStop > this.state.trailingStop) {
            this.state.trailingStop = newStop;
            this.log(`📈 [BOT ENGINE] Trailing Stop actualizado: ${newStop.toFixed(2)}`);
        }

        if (candle.close <= this.state.trailingStop) {
            this.log(`📉 [BOT ENGINE] Stop Loss alcanzado en ${this.state.trailingStop.toFixed(2)}. Vendiendo...`);
            this.executeSell();
        }
    }

    async executeSell() {
        // Lógica de venta
        this.log(`💸 VENTA EJECUTADA. Cerrando posición.`);
        this.state.status = 'ANALYZING'; // Volver a buscar
        this.state.position = null;
        this.state.trailingStop = null;
    }
    
    // Método para inyectar datos históricos al iniciar
    setHistoricalData(data) {
        this.state.candles = data;
    }
    
    getStatus() {
        return this.state;
    }
}

module.exports = BotEngine;
