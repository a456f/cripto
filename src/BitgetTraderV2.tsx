// c:\Users\ANTHONY\Downloads\sistema_crip\src\BitgetTraderV2.tsx
import React, { useState, useEffect, useRef } from 'react';
import { FiKey, FiLock, FiShield, FiDollarSign, FiActivity, FiTerminal, FiSettings, FiPlay, FiTrendingUp, FiCheckCircle, FiBriefcase, FiTarget, FiInfo, FiCpu, FiList, FiXCircle, FiClock } from 'react-icons/fi';
import CryptoJS from 'crypto-js';
import { useBitgetSocket } from './useBitgetSocket';
import { processStream, type Candle } from './marketData';
import { getSignalForTimeframe, type TimeframeAnalysis } from './strategy';
import { getFinalSignal, type TimeframeSignals } from './signals';
import { calculatePositionSize } from './riskManager';
import { placeOrder } from './trader';
// import { analyzeMarketWithAI } from './claudeService'; // AI logic is replaced by the new strategy
import './BitgetTraderV2.css';

type BotStatus =
  | 'IDLE'
  | 'ANALYZING_MARKET'
  | 'WAITING_PULLBACK'
  | 'AI_CONFIRMATION'
  | 'BUYING'
  | 'IN_POSITION'
  | 'TRAILING_ACTIVE'
  | 'EXITING'
  | 'ANALYZING';


const BitgetTraderV2: React.FC = () => {
  // --- ESTADOS DE CREDENCIALES ---
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_BITGET_API_KEY || '');
  const [secretKey, setSecretKey] = useState(import.meta.env.VITE_BITGET_SECRET_KEY || '');
  const [passphrase, setPassphrase] = useState(import.meta.env.VITE_BITGET_PASSPHRASE || '');
  const [anthropicKey, setAnthropicKey] = useState(import.meta.env.VITE_CLAUDE_API_KEY || '');

  // --- ESTADOS DEL BOT ---
  const [botStatus, setBotStatus] = useState<BotStatus>('IDLE');
  const [logs, setLogs] = useState<string[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [trailingStop, setTrailingStop] = useState<number | null>(null);
  const [unrealizedPnl, setUnrealizedPnl] = useState({ percent: 0, usdt: 0 });
  const [botBalance, setBotBalance] = useState<number>(1000); // Balance simulado para riskManager
  const [openPositions, setOpenPositions] = useState<any[]>([]);
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const currentTaskIdRef = useRef<string | null>(null);
  const [timeframeAnalyses, setTimeframeAnalyses] = useState<Record<string, TimeframeAnalysis>>({
    '5m': { trend: 'NEUTRAL', volume: 'NO_CONFIRMATION', sma: 'NEUTRAL', rsi: 'NEUTRAL', macd: 'NEUTRAL', finalSignal: 'NEUTRAL' },
    '1h': { trend: 'NEUTRAL', volume: 'NO_CONFIRMATION', sma: 'NEUTRAL', rsi: 'NEUTRAL', macd: 'NEUTRAL', finalSignal: 'NEUTRAL' },
    '4h': { trend: 'NEUTRAL', volume: 'NO_CONFIRMATION', sma: 'NEUTRAL', rsi: 'NEUTRAL', macd: 'NEUTRAL', finalSignal: 'NEUTRAL' },
  });

  // --- REFERENCIAS PARA ESTRATEGIA ---
  const candles1m = useRef<Candle[]>([]);
  const candles5m = useRef<Candle[]>([]);
  const candles1h = useRef<Candle[]>([]);
  const candles4h = useRef<Candle[]>([]);
  const entryPriceRef = useRef<number>(0);
  const positionSizeRef = useRef<number>(0);
  const baseQuantityRef = useRef<number>(0); // Cantidad en BTC
  const highDuringTradeRef = useRef<number>(0);
const { lastMessage, connectionStatus } = useBitgetSocket([
  { instType: 'SPOT', channel: 'candle1m', instId: 'BTCUSDT' }
]);
const [isServerAlive, setIsServerAlive] = useState(false);
  const addLog = (msg: string) => {
    const timeMsg = `[${new Date().toLocaleTimeString()}] ${msg}`;
    setLogs(prev => [timeMsg, ...prev].slice(0, 50));

    // Si hay una tarea iniciada, enviamos el log al servidor para el TXT final
    if (currentTaskIdRef.current) {
      fetch(`http://31.97.253.128:3001/api/positions/${currentTaskIdRef.current}/logs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log: timeMsg }) // Enviamos el log con timestamp
      })
      .then(res => res.ok ? res.json() : null)
      .then(updatedPosition => {
        if (updatedPosition) {
          // Actualiza la tarea específica en el estado para reflejar el log en tiempo real
          setOpenPositions(prev => 
            prev.map(p => p.id === updatedPosition.id ? updatedPosition : p)
          );
        }
      })
      .catch((e) => console.error("Fallo al sincronizar log:", e));
    }
  };

  const refreshBalance = async () => {
    // No refrescar si no hay llaves, para evitar errores 401 en la consola del backend.
    if (!apiKey || !secretKey || !passphrase) return;

    try {
      const res = await fetch('http://31.97.253.128:3001/api/bitget-assets');
      if (!res.ok) return; // Fallar silenciosamente en errores HTTP
      const data = await res.json();
      if (data.code === '00000') {
        const usdtAsset = data.data?.find((asset: any) => asset.coin === 'USDT');
        if (usdtAsset && usdtAsset.available) {
          const availableUsdt = parseFloat(usdtAsset.available);
          setBotBalance(availableUsdt);
        }
      }
    } catch (e) { /* Fallar silenciosamente en errores de red */ }
  };

  const playNotifySound = () => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
    audio.play().catch(e => console.log("Interacción de usuario requerida para sonido"));
  };

  // --- MONITOREO: LATIDO DEL BOT ---
  useEffect(() => {
    const checkHeartbeat = () => {
      fetch('http://31.97.253.128:3001/api/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: botStatus, currentPrice, symbol: 'BTCUSDT' })
      })
      .then(() => setIsServerAlive(true))
      .catch(() => setIsServerAlive(false));
    };

    checkHeartbeat(); // Verificar al montar
    refreshBalance(); // Cargar balance al inicio
    const hbInterval = setInterval(checkHeartbeat, 10000);
    const posInterval = setInterval(refreshOpenPositions, 5000); // Refrescar tareas cada 5s
    const balanceInterval = setInterval(refreshBalance, 15000); // Refrescar balance cada 15s

    return () => {
      clearInterval(hbInterval);
      clearInterval(posInterval);
      clearInterval(balanceInterval);
    };
  }, [botStatus, currentPrice]);

  // --- CARGAR TRADES DEL SERVIDOR ---
  const refreshTrades = async () => {
    try {
      const res = await fetch('http://31.97.253.128:3001/api/trades');
      const data = await res.json();
      setRecentTrades(data.reverse().slice(0, 5)); // Últimos 5
    } catch (e) { console.error("Error cargando trades"); }
  };

  const refreshOpenPositions = async () => {
    try {
      const res = await fetch('http://31.97.253.128:3001/api/positions/active');
      const data = await res.json();
      setOpenPositions(data);

      // --- LÓGICA DE RECUPERACIÓN DE ESTADO AL CARGAR LA PÁGINA ---
      if (data.length > 0 && botStatus === 'IDLE') {
        const activeTask = data[0]; // Asumimos que solo hay una tarea activa
        addLog(`🔄 Tarea activa recuperada del servidor: ${activeTask.id}. Estado: ${activeTask.status}`);
        currentTaskIdRef.current = activeTask.id;

        if (activeTask.status === 'IN_POSITION' && activeTask.entryPrice) {
          addLog(`🔄 Recuperando estado de operación abierta...`);
          entryPriceRef.current = activeTask.entryPrice;
          positionSizeRef.current = activeTask.positionSize;
          baseQuantityRef.current = activeTask.baseQuantity;
          highDuringTradeRef.current = activeTask.entryPrice; // Reset high to entry on recovery

          const stopLossPrice = activeTask.entryPrice * (1 - 0.02); // 2% SL
          setTrailingStop(stopLossPrice);
          setBotStatus('IN_POSITION');
        } else {
          // Si el estado es ANALYZING o cualquier otro, simplemente reanudamos el análisis.
          addLog(`🔄 Reanudando análisis de mercado.`);
          setBotStatus('ANALYZING');
        }
      } else if (data.length === 0 && botStatus !== 'IDLE') {
        // Si el servidor no tiene tareas pero el bot cree que está activo, lo reseteamos.
        addLog("🔌 No hay tareas en el servidor. Sincronizando estado a IDLE.");
        setBotStatus('IDLE');
        currentTaskIdRef.current = null;
      }
    } catch (e) { console.error("Error cargando posiciones"); }
  };

  // --- LÓGICA DE FIRMA ---
  const sign = (timestamp: string, method: string, path: string, body: string = '') => {
    return CryptoJS.HmacSHA256(timestamp + method + path + body, secretKey).toString(CryptoJS.enc.Base64);
  };

  // --- VERIFICACIÓN DE CREDENCIALES ---
  const verifyCredentials = async () => {
    if (!apiKey || !secretKey || !passphrase || !anthropicKey) {
      return alert("Por favor, completa todas las credenciales antes de verificar.");
    }
    
    setIsVerifying(true);
    addLog("🔍 Iniciando verificación de seguridad...");

    // 1. Verificar Bitget (Obteniendo activos de la cuenta)
  // 1. Verificar Bitget
try {

  const res = await fetch('http://31.97.253.128:3001/api/bitget-assets');

  const data = await res.json();
  if (data.code === '00000') {
    addLog("✅ Bitget API: Conexión exitosa y autenticada.");
    const usdtAsset = data.data?.find((asset: any) => asset.coin === 'USDT');
    if (usdtAsset && usdtAsset.available) {
      const availableUsdt = parseFloat(usdtAsset.available);
      setBotBalance(availableUsdt);
      addLog(`💰 Balance real detectado: ${availableUsdt.toFixed(2)} USDT.`);
    } else {
      addLog("⚠️ No se pudo encontrar balance de USDT. Usando balance simulado de 1000 USDT.");
      setBotBalance(1000); // Fallback to simulated balance
    }
  } else {
    addLog(`❌ Bitget API: Error (${data.msg})`);
  }
} catch (e: any) {

  addLog(`❌ Bitget API: Error de conexión`);

}

    // 2. Verificar Claude
    try {
      const response = await fetch('http://31.97.253.128:3001/api/verify-claude');
      const data = await response.json();
      if (response.ok) {
        addLog("✅ Claude AI: Llave válida y activa.");
      } else {
        addLog(`❌ Claude AI: ${data.message || 'Error de autenticación'}. Revisa el servidor.`);
      }
    } catch (e) {
      addLog("❌ Claude AI: Error de conexión.");
    }
    setIsVerifying(false);
  };

  const aggregateCandles = (new1mCandle: Candle) => {
    const candleTime = new Date(parseInt(new1mCandle.timestamp));
    
    const timeframes = { '5m': 5, '1h': 60, '4h': 240 };
    let analysisTriggered = false;

    for (const [tf, minutes] of Object.entries(timeframes)) {
        const candleArray = tf === '5m' ? candles5m : tf === '1h' ? candles1h : candles4h;
        const interval = minutes * 60 * 1000;
        const candleTimestamp = Math.floor(candleTime.getTime() / interval) * interval;

        if (candleArray.current.length > 0 && candleArray.current[0].timestamp === candleTimestamp.toString()) {
            // Update existing candle
            const currentTfCandle = candleArray.current[0];
            currentTfCandle.high = Math.max(currentTfCandle.high, new1mCandle.high);
            currentTfCandle.low = Math.min(currentTfCandle.low, new1mCandle.low);
            currentTfCandle.close = new1mCandle.close;
            currentTfCandle.volume += new1mCandle.volume;
        } else {
            // New candle for this timeframe
            const newTfCandle: Candle = {
                timestamp: candleTimestamp.toString(),
                open: new1mCandle.open,
                high: new1mCandle.high,
                low: new1mCandle.low,
                close: new1mCandle.close,
                volume: new1mCandle.volume,
            };
            candleArray.current.unshift(newTfCandle);
            if (candleArray.current.length > 200) candleArray.current.pop();

            // Trigger analysis on the close of a 5m candle
            if (tf === '5m' && botStatus === 'ANALYZING') {
                analysisTriggered = true;
            }
        }
    }

    if (analysisTriggered) {
        runStrategyAnalysis();
    }
  };

  const runStrategyAnalysis = async () => {
    if (botStatus !== 'ANALYZING') return;

    addLog("🧠 Analizando timeframes [4h, 1h, 5m]...");

    const analyses: Record<string, TimeframeAnalysis> = {
        '4h': getSignalForTimeframe(candles4h.current),
        '1h': getSignalForTimeframe(candles1h.current),
        '5m': getSignalForTimeframe(candles5m.current),
    };
    setTimeframeAnalyses(analyses);

    const signals: TimeframeSignals = {
        '4h': analyses['4h'].finalSignal,
        '1h': analyses['1h'].finalSignal,
        '5m': analyses['5m'].finalSignal,
    };

    const finalSignal = getFinalSignal(signals);

    const logMessage = `
    --- ANÁLISIS MULTI-TIMEFRAME ---
    4h: ${signals['4h']} | 1h: ${signals['1h']} | 5m: ${signals['5m']}
    ==> SEÑAL FINAL: ${finalSignal}
    `;
    addLog(logMessage.replace(/\n\s+/g, '\n').trim());

    if (finalSignal === 'EXECUTE_LONG') {
        setBotStatus('BUYING');
        addLog(`🎯 Señal LONG confirmada. Calculando riesgo y ejecutando orden...`);
        
        const stopLossPercent = 0.02; // 2%
        let positionSize = calculatePositionSize(botBalance, 0.10, stopLossPercent);
        
        // --- AJUSTE INTELIGENTE DE POSICIÓN PARA SPOT ---
        // Si el tamaño calculado excede el balance, se ajusta al máximo disponible.
        if (positionSize > botBalance) {
            addLog(`⚠️ Tamaño de posición ideal (${positionSize.toFixed(2)} USDT) excede balance. Ajustando al máximo disponible: ${botBalance.toFixed(2)} USDT.`);
            positionSize = botBalance;
        }

        // Verificación de monto mínimo de orden (Bitget suele requerir > 5 o 10 USDT)
        const minOrderSize = 10;
        if (positionSize < minOrderSize) {
            addLog(`📉 Tamaño de posición (${positionSize.toFixed(2)} USDT) es menor al mínimo requerido de ${minOrderSize} USDT. Abortando.`);
            setBotStatus('ANALYZING');
            return;
        }

        addLog(`💵 Tamaño de posición calculado: ${positionSize.toFixed(2)} USDT.`);
        
        const result = await placeOrder('buy', positionSize.toFixed(4));

        if (result.code === '00000') {
            const entryPrice = currentPrice;
            entryPriceRef.current = entryPrice;
            highDuringTradeRef.current = entryPrice;
            positionSizeRef.current = positionSize;
            baseQuantityRef.current = positionSize / entryPrice; // Guardar cantidad de BTC

            const stopLossPrice = entryPrice * (1 - stopLossPercent);
            setTrailingStop(stopLossPrice); // Initial stop loss becomes a trailing stop
            setBotStatus('IN_POSITION');

            // Actualizar la tarea en el backend con los detalles de la operación
            if (currentTaskIdRef.current) {
              fetch(`http://31.97.253.128:3001/api/positions/${currentTaskIdRef.current}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    status: 'IN_POSITION', 
                    entryPrice,
                    positionSize,
                    baseQuantity: baseQuantityRef.current
                })
              });
            }
            
            const targets = {
                t1: entryPrice * 1.01,
                t2: entryPrice * 1.02,
                t3: entryPrice * 1.03,
            };

            addLog(`
            ✅ ORDEN DE COMPRA EJECUTADA
            Entrada: ${entryPrice.toFixed(2)}
            Stop Loss Inicial: ${stopLossPrice.toFixed(2)}
            Target 1 (50%): ${targets.t1.toFixed(2)}
            Target 3 (Resto): ${targets.t3.toFixed(2)}
            `);
            // NOTE: Logic for partial take profit needs to be implemented here.
            // The current implementation only has a trailing stop for the whole position.
        } else {
            addLog(`❌ Error al ejecutar orden: ${result.msg}`);
            setBotStatus('ANALYZING');
        }
    }
    // NOTE: Shorting logic for SPOT is selling the asset.
    // If a 'EXECUTE_SHORT' signal is received, you would sell your BTC holdings.
    // This implementation focuses on the LONG side as per the typical BTC/USDT spot strategy.
  };

  // --- LÓGICA DE SALIDA CENTRALIZADA ---
  const handleExitPosition = async (reasonMsg: string, price: number) => {
    addLog(`${reasonMsg} Finalizando proceso y cerrando tarea...`);
    
    const positionId = currentTaskIdRef.current;

    const btcToSell = baseQuantityRef.current;
    if (btcToSell <= 0) {
        addLog("❌ Error al cerrar: Cantidad de BTC en posición es cero o inválida.");
        // Reset state anyway to be safe
        setBotStatus('IDLE');
        setTrailingStop(null);
        entryPriceRef.current = 0;
        positionSizeRef.current = 0;
        baseQuantityRef.current = 0;
        return;
    }

    addLog(`💸 Intentando vender ${btcToSell.toFixed(6)} BTC...`);
    const res = await placeOrder('sell', btcToSell.toFixed(6));
    setBotStatus('IDLE');
    setTrailingStop(null);
    entryPriceRef.current = 0;
    positionSizeRef.current = 0;
    baseQuantityRef.current = 0;
    
    if (positionId) {
      await fetch(`http://31.97.253.128:3001/api/positions/${positionId}`, { method: 'DELETE' });
    }
    
    await fetch('http://31.97.253.128:3001/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: 'sell', price, orderId: res.data?.orderId })
    });
    
    currentTaskIdRef.current = null;
    refreshTrades();
    refreshOpenPositions();
  };

  // --- MOTOR DE ESTRATEGIA (WEBSOCKET) ---
  useEffect(() => {
    if (
      !lastMessage ||
      lastMessage.arg?.channel !== 'candle1m' ||
      !Array.isArray(lastMessage.data) ||
      lastMessage.data.length === 0
    ) return;

    const newCandleData = processStream(lastMessage);
    if (!newCandleData) return;

    setCurrentPrice(newCandleData.close);

    // Update 1m candles
    if (candles1m.current.length === 0 || candles1m.current[0].timestamp !== newCandleData.timestamp) {
        candles1m.current.unshift(newCandleData);
        if (candles1m.current.length > 400) candles1m.current.pop(); // Keep enough for 4h aggregation
        
        // Trigger aggregation for other timeframes
        aggregateCandles(newCandleData);
    } else {
        // Update current 1m candle
        candles1m.current[0] = newCandleData;
    }

    // PNL Calculation
    if (botStatus === 'IN_POSITION' && entryPriceRef.current > 0) {
      const pnlPercent = ((newCandleData.close - entryPriceRef.current) / entryPriceRef.current) * 100;
      const pnlUsdt = (pnlPercent / 100) * positionSizeRef.current;
      setUnrealizedPnl({ percent: pnlPercent, usdt: pnlUsdt });
    }

    // Trailing Stop Logic
    if ((botStatus === 'IN_POSITION' || botStatus === 'TRAILING_ACTIVE') && trailingStop) {
      if (newCandleData.close > highDuringTradeRef.current) {
        highDuringTradeRef.current = newCandleData.close;
        const newStop = newCandleData.close * 0.98; // 2% trailing stop
        if (newStop > trailingStop) {
          setTrailingStop(newStop);
          setBotStatus('TRAILING_ACTIVE');
          addLog(`📈 Nuevo máximo en trade: ${newCandleData.close.toFixed(2)}. Trailing Stop actualizado a ${newStop.toFixed(2)}`);
        }
      }
      if (newCandleData.close <= trailingStop) {
        handleExitPosition(`📉 Trailing stop alcanzado en ${trailingStop.toFixed(2)}`, newCandleData.close);
      }
    }
  }, [lastMessage, botStatus, trailingStop]);

  useEffect(() => {
    refreshTrades();
    refreshOpenPositions();
  }, []);

  const handleStartBot = async () => {
    if (botStatus === 'IDLE') {
        addLog("🚀 Iniciando motor de estrategia. Creando tarea en backend...");
        try {
            const res = await fetch('http://31.97.253.128:3001/api/positions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) // No se necesita cuerpo
            });
            if (res.ok) {
                const newPosition = await res.json();
                currentTaskIdRef.current = newPosition.id;
                addLog(`✅ Tarea ${newPosition.id} registrada. Iniciando análisis.`);
                setBotStatus('ANALYZING');
                refreshOpenPositions();
            } else {
                addLog("❌ Error al registrar la tarea en el servidor.");
            }
        } catch (e) {
            addLog("❌ Error de red. No se pudo comunicar con el backend.");
        }
    } else {
        if (botStatus === 'IN_POSITION' || botStatus === 'TRAILING_ACTIVE') {
            addLog("⚠️ No se puede detener mientras hay una operación activa. Cierre la posición primero.");
            return;
        }
        addLog("🛑 Deteniendo motor de estrategia. Eliminando tarea del backend...");
        if (currentTaskIdRef.current) {
            try {
                await fetch(`http://31.97.253.128:3001/api/positions/${currentTaskIdRef.current}`, {
                    method: 'DELETE'
                });
                addLog(`✅ Tarea ${currentTaskIdRef.current} eliminada del servidor.`);
            } catch (e) {
                addLog("❌ Error de red al intentar eliminar la tarea.");
            }
        }
        currentTaskIdRef.current = null;
        setBotStatus('IDLE');
        refreshOpenPositions();
    }
  };

  return (
    <div className="trader-v2-container">
      <div className="trader-header">
        <div className="title-section">
          <FiActivity className="icon-pulse" />
          <h2 className="trader-v2-title">Bitget Algorithmic Bot V2.0</h2>
        </div>
        <div className="status-badge" data-status={botStatus}>
          <span className="status-dot"></span>
          Estado: {botStatus}
        </div>
      </div>

      <div className="trader-grid">
        <div className="trader-card credentials-card">
          <div className="card-header">
            <FiSettings /> <h3>Configuración de API</h3>
          </div>
          <div className="form-inputs">
            <div className="input-with-icon">
              <FiKey />
              <input type="password" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} className="trader-v2-input" />
            </div>
            <div className="input-with-icon">
              <FiLock />
              <input type="password" placeholder="Secret Key" value={secretKey} onChange={e => setSecretKey(e.target.value)} className="trader-v2-input" />
            </div>
            <div className="input-with-icon">
              <FiShield />
              <input type="password" placeholder="Passphrase" value={passphrase} onChange={e => setPassphrase(e.target.value)} className="trader-v2-input" />
            </div>
            <div className="input-with-icon">
              <FiActivity />
              <input type="password" placeholder="Claude API Key" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} className="trader-v2-input" />
            </div>
            <button onClick={verifyCredentials} disabled={isVerifying} className="btn-verify">
              {isVerifying ? "Verificando..." : "Verificar Conexiones"}
            </button>
          </div>
        </div>

        <div className="trader-card market-card">
          <div className="card-header">
            <FiTrendingUp /> <h3>Estado del Mercado</h3>
          </div>
          <div className="market-stats">
            <div className="stat-item">
              <span className="stat-label">BTC/USDT</span>
              <span className="stat-value price-value">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Servidor Local</span>
              <span className={`stat-value ${isServerAlive ? 'text-green' : 'text-red'}`}>{isServerAlive ? 'EN LÍNEA' : 'OFFLINE'}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Balance USDT</span>
              <span className="stat-value">${botBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            {trailingStop && botStatus !== 'IDLE' && (
              <div className="stat-item stop-active">
                <span className="stat-label">Trailing Stop</span>
                <span className="stat-value">${trailingStop.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="trader-card settings-card">
          <div className="card-header">
            <FiDollarSign /> <h3>Parámetros de Trading</h3>
          </div>
          <div className="risk-params">
            <div className="param-item"><span>Balance:</span> <span>{botBalance.toFixed(2)} USDT</span></div>
            <div className="param-item"><span>Riesgo por Op.:</span> <span>10% ({ (botBalance * 0.1).toFixed(2) } USDT)</span></div>
            <div className="param-item"><span>Stop Loss:</span> <span>2%</span></div>
          </div>
          <button 
            onClick={handleStartBot} 
            className={`btn-operate ${botStatus !== 'IDLE' ? 'active' : ''}`}
            disabled={botStatus === 'BUYING' || botStatus === 'EXITING'}
          >
            <FiPlay /> 
            {botStatus === 'IDLE' ? 'INICIAR BOT' : 'DETENER BOT'}
          </button>
        </div>
      </div>

      {/* --- SECCIÓN DE TAREAS/PROCESOS ACTIVOS --- */}
      <div className="trader-card tasks-card">
        <div className="card-header">
          <FiList /> <h3>Tareas en Ejecución (Seguimiento Individual)</h3>
        </div>
        <div className="tasks-container">
          {openPositions.length === 0 ? (
            <div className="log-placeholder">Sin procesos activos en este momento.</div>
          ) : (
            openPositions.map((pos) => (
              <div key={pos.id} className="task-item">
                <div className="task-header">
                  <span className="task-id">ID: {pos.id.slice(-6)}</span>
                  <span className="task-status">ESTADO: {currentTaskIdRef.current === pos.id ? botStatus : 'EN PROCESO'}</span>
                  <button className="btn-task-close" onClick={() => handleExitPosition('⚠️ Cierre manual.', currentPrice)}>
                    <FiXCircle /> Vender y Cerrar
                  </button>
                </div>
                <div className="task-body">
                  <div className="task-console">
                    <div className="console-label">Proceso de la operación:</div>
                    {pos.logs && pos.logs.slice(-8).map((l: string, idx: number) => (
                      <div key={idx} className="task-log-entry">{l}</div>
                    ))}
                  </div>
                  <div className="task-stats">
                    <div className="console-label">Estado actual:</div>
                    {botStatus === 'IN_POSITION' ? (
                      <>
                        <div className="stat-row">
                          <span>PnL (%):</span>
                          <span className={`value ${unrealizedPnl.percent >= 0 ? 'text-green' : 'text-red'}`}>
                            {unrealizedPnl.percent >= 0 ? '+' : ''}{unrealizedPnl.percent.toFixed(3)}%
                          </span>
                        </div>
                        <div className="stat-row">
                          <span>PnL (USDT):</span>
                          <span className={`value ${unrealizedPnl.usdt >= 0 ? 'text-green' : 'text-red'}`}>
                            {unrealizedPnl.usdt.toFixed(4)} USDT
                          </span>
                        </div>
                        <div className="stat-row">
                          <span>Precio:</span>
                          <span className="value">${currentPrice.toLocaleString()}</span>
                        </div>
                        {trailingStop && (
                          <div className="stat-row">
                            <span>Stop:</span>
                            <span className="value text-orange">${trailingStop.toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="stat-row">
                        <span>Status:</span>
                        <span className="value">{botStatus}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="trader-card monitoring-card">
        <div className="card-header">
          <FiCpu /> <h3>Monitor de Sistema</h3>
        </div>
        <div className="timeframe-analysis-grid">
          {['4h', '1h', '5m'].map(tf => (
            <div key={tf} className="timeframe-card">
              <div className="timeframe-header">
                <FiClock /> {tf}
              </div>
              <div className={`timeframe-signal ${timeframeAnalyses[tf]?.finalSignal}`}>
                {timeframeAnalyses[tf]?.finalSignal || 'NEUTRAL'}
              </div>
              <div className="timeframe-indicators">
                Trend: {timeframeAnalyses[tf]?.trend.slice(0,4)} · Vol: {timeframeAnalyses[tf]?.volume.slice(0,4)} · SMA: {timeframeAnalyses[tf]?.sma.slice(0,4)} · RSI: {timeframeAnalyses[tf]?.rsi.slice(0,4)} · MACD: {timeframeAnalyses[tf]?.macd.slice(0,4)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="trader-card history-card">
        <div className="card-header">
          <FiBriefcase /> <h3>Historial de Operaciones (Persistente)</h3>
        </div>
        <div className="table-wrapper">
          <table className="trades-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Lado</th>
                <th>Precio</th>
                <th>Monto/ID</th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '20px', color: '#484f58' }}>No hay operaciones registradas</td></tr>
              ) : (
                recentTrades.map((t, i) => (
                  <tr key={i}>
                    <td>{new Date(t.serverTimestamp).toLocaleTimeString()}</td>
                    <td className={t.side === 'buy' ? 'text-green' : 'text-red'}>
                      {t.side.toUpperCase()}
                    </td>
                    <td>${parseFloat(t.price).toLocaleString()}</td>
                    <td style={{ fontSize: '0.7rem', color: '#8b949e' }}>
                      {t.amount ? `${t.amount} USDT` : t.orderId}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="trader-card terminal-card">
        <div className="card-header">
          <FiTerminal /> <h3>Terminal de Ejecución</h3>
        </div>
        <div className="log-container">
          {logs.length === 0 ? (
            <div className="log-placeholder">Esperando inicio de actividad...</div>
          ) : (
            logs.map((msg, i) => <div key={i} className="log-entry">{msg}</div>)
          )}
        </div>
      </div>
    </div>
  );
};

export default BitgetTraderV2
