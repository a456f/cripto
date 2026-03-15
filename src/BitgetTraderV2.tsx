// c:\Users\ANTHONY\Downloads\sistema_crip\src\BitgetTraderV2.tsx
import React, { useState, useEffect, useRef } from 'react';
import { FiKey, FiLock, FiShield, FiDollarSign, FiActivity, FiTerminal, FiSettings, FiPlay, FiTrendingUp, FiCheckCircle, FiBriefcase, FiTarget, FiInfo, FiCpu, FiList, FiXCircle, FiClock } from 'react-icons/fi';
import CryptoJS from 'crypto-js';
import { useBitgetSocket } from './useBitgetSocket';
import * as marketData from './marketData';
import * as strategy from './strategy';
import * as signals from './signals';
import * as riskManager from './riskManager';
import * as trader from './trader';
import { analyzeMarketWithAI } from './claudeService';
import './BitgetTraderV2.css';

type BotStatus =
  | 'IDLE'
  | 'ANALYZING_MARKET'
  | 'WAITING_PULLBACK'
  | 'AI_CONFIRMATION'
  | 'BUYING'
  | 'IN_POSITION'
  | 'TRAILING_ACTIVE'
  | 'EXITING';


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
  const [currentVol, setCurrentVol] = useState<number>(0);
  const [trailingStop, setTrailingStop] = useState<number | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number>(0);
  const [marketPhase, setMarketPhase] = useState<string>('N/A');
  const [aiAnalysis, setAiAnalysis] = useState<{ reason: string; confidence: number; decision: string } | null>(null);
  const [unrealizedPnl, setUnrealizedPnl] = useState({ percent: 0, usdt: 0 });
  const [botBalance, setBotBalance] = useState<number>(1000); // Balance simulado para riskManager
type StrategyKey = '5m' | '4h' | '6h';

const [selectedStrategy, setSelectedStrategy] = useState<StrategyKey>('5m');

const [strategyAmounts, setStrategyAmounts] = useState<Record<StrategyKey, string>>({
  '5m': '15',
  '4h': '100',
  '6h': '250'
});
  const [openPositions, setOpenPositions] = useState<any[]>([]);
  const [aiReason, setAiReason] = useState<string>('');
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const currentTaskIdRef = useRef<string | null>(null);

  // --- REFERENCIAS PARA ESTRATEGIA ---
  const historyRef = useRef<marketData.Candle[]>([]);
  const entryPriceRef = useRef<number>(0);
  const positionSizeRef = useRef<number>(0);
  const lastAiAnalysisTimeRef = useRef<number>(0);
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
    const hbInterval = setInterval(checkHeartbeat, 10000);
    const posInterval = setInterval(refreshOpenPositions, 5000); // Refrescar tareas cada 5s

    return () => {
      clearInterval(hbInterval);
      clearInterval(posInterval);
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

      // --- LÓGICA DE RECUPERACIÓN DE ESTADO ---
      if (data.length > 0 && botStatus === 'IDLE') {
        const lastPosition = data[data.length - 1];
        addLog(`🔄 Tarea activa recuperada del servidor. ID: ${lastPosition.id}`);
        currentTaskIdRef.current = lastPosition.id;
        entryPriceRef.current = lastPosition.price;
        positionSizeRef.current = parseFloat(lastPosition.amount);
        setBotStatus('IN_POSITION'); // Reanudar el estado de seguimiento
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
    try {
      const timestamp = Date.now().toString();
      const path = '/api/v2/spot/account/assets';
      const res = await fetch(`/bitget-api${path}`, {
        method: 'GET',
        headers: {
          'ACCESS-KEY': apiKey,
          'ACCESS-SIGN': sign(timestamp, 'GET', path, ''),
          'ACCESS-PASSPHRASE': passphrase,
          'ACCESS-TIMESTAMP': timestamp,
          'Content-Type': 'application/json',
        }
      });
      const data = await res.json();
      if (data.code === '00000') addLog("✅ Bitget API: Conexión exitosa y autenticada.");
      else addLog(`❌ Bitget API: Error (${data.msg})`);
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

  // --- EJECUCIÓN DE ÓRDENES ---
  const placeOrder = async (side: 'buy' | 'sell', size: string) => {
    const timestamp = Date.now().toString();
    const path = '/api/v2/spot/trade/place-order';
    const body = JSON.stringify({
      symbol: 'BTCUSDT',
      side,
      orderType: 'market',
      size,
      force: 'gtc' // Good-Til-Canceled
    });

    try {
      const res = await fetch(`/bitget-api${path}`, {
        method: 'POST',
        headers: {
          'ACCESS-KEY': apiKey,
          'ACCESS-SIGN': sign(timestamp, 'POST', path, body),
          'ACCESS-PASSPHRASE': passphrase,
          'ACCESS-TIMESTAMP': timestamp,
          'Content-Type': 'application/json',
        },
        body
      });
      return await res.json();
    } catch (e: any) {
      return { code: 'ERROR', msg: `Network Error: ${e.message}` };
    }
  };

  // --- MOTOR DE ESTRATEGIA (ACTUALIZADO POR WEBSOCKET) ---
// --- MOTOR DE ESTRATEGIA (WEBSOCKET) ---
useEffect(() => {

  if (
    !lastMessage ||
    lastMessage.arg?.channel !== 'candle1m' ||
    !Array.isArray(lastMessage.data) ||
    lastMessage.data.length === 0
  ) return;

  const candle = lastMessage.data[0];

  const price = parseFloat(candle[4]);
  const volume = parseFloat(candle[5]);
  const ts = candle[0];

  if (isNaN(price)) return;

  setCurrentPrice(price);
  setCurrentVol(volume);
if (botStatus === 'IN_POSITION' && entryPriceRef.current > 0) {

  const pnlPercent =
    ((price - entryPriceRef.current) / entryPriceRef.current) * 100;

  const pnlUsdt =
    (pnlPercent / 100) * positionSizeRef.current;

  setUnrealizedPnl({
    percent: pnlPercent,
    usdt: pnlUsdt
  });

}

  // Guardar vela
  if (
    historyRef.current.length === 0 ||
    historyRef.current[0].timestamp !== ts
  ) {

    historyRef.current = [
      {
        timestamp: ts,
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: price,
        volume: volume
      },
      ...historyRef.current
    ].slice(0, 20);

  }

  if (botStatus === 'IDLE') return;

  // --------------------------
  // TRAILING STOP
  // --------------------------
if (botStatus === 'IN_POSITION' && trailingStop) {

  if (price > highDuringTradeRef.current) {

    highDuringTradeRef.current = price;

    const newStop = price * 0.995;

    setTrailingStop(newStop);

    setBotStatus('TRAILING_ACTIVE');

    addLog(`📈 Nuevo máximo detectado: ${price}. Trailing actualizado`);

  }

  if (price <= trailingStop) {

    handleExitPosition(`📉 Trailing stop alcanzado`, price);

  }

  return;

}



  if (historyRef.current.length < 5) return;

  // --------------------------
  // ANALISIS MERCADO
  // --------------------------

  if (botStatus === 'ANALYZING_MARKET') {

    const structure = strategy.analyzeTrend(historyRef.current);

    if (structure.trend === 'BULLISH') {

      addLog("📈 Tendencia alcista detectada. Esperando pullback");

      setBotStatus('WAITING_PULLBACK');

    }

  }

  // --------------------------
  // PULLBACK
  // --------------------------

  else if (botStatus === 'WAITING_PULLBACK') {

    const structure = strategy.analyzeTrend(historyRef.current);

    const signal = signals.detectSignal(
      structure.trend,
      price,
      historyRef.current[1]
    );

    if (signal === 'LONG_ENTRY') {

      if (isAiAnalyzing) return;

      setBotStatus('AI_CONFIRMATION');

      setIsAiAnalyzing(true);

      addLog("🧠 Consultando IA para validar entrada");

      analyzeMarketWithAI(historyRef.current)
        .then(ai => {

          if (ai.decision === 'BUY') {

            setAiConfidence(ai.confidence || 0);

            addLog(`✅ IA aprobó entrada (${ai.confidence}%)`);

            setBotStatus('BUYING');

            executeTrade(strategyAmounts[selectedStrategy]);

          } else {

            addLog(`✋ IA rechazó entrada: ${ai.reason}`);

            setBotStatus('ANALYZING_MARKET');

          }

        })
        .finally(() => setIsAiAnalyzing(false));

    }

  }

}, [lastMessage, botStatus, trailingStop]);


  // --- LÓGICA DE SALIDA CENTRALIZADA ---
  const handleExitPosition = async (reasonMsg: string, price: number) => {
    addLog(`${reasonMsg} Finalizando proceso y cerrando tarea...`);
    
    const positionId = currentTaskIdRef.current;

    const res = await placeOrder('sell', '0.0001');
    setBotStatus('IDLE');
    setTrailingStop(null);
    entryPriceRef.current = 0;
    positionSizeRef.current = 0;
    
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
const executeTrade = async (size: string) => {

  const result = await placeOrder('buy', size);

  if (result.code === '00000') {

    entryPriceRef.current = currentPrice;
    highDuringTradeRef.current = currentPrice;
    positionSizeRef.current = parseFloat(size);

    setTrailingStop(currentPrice * 0.996);
    setBotStatus('IN_POSITION');

    addLog(`✅ Orden ejecutada. Precio ${currentPrice}`);

  } else {

    addLog(`❌ Error al ejecutar orden: ${result.msg}`);
    setBotStatus('ANALYZING_MARKET');

  }

};
  useEffect(() => {
    refreshTrades();
    refreshOpenPositions();
  }, []);

  const handleStartBot = async () => {
    if (!apiKey || !secretKey || !passphrase) return alert("Por favor, ingresa tus credenciales API.");
    const amount = strategyAmounts[selectedStrategy];
    addLog(`🚀 Lanzando tarea al backend con estrategia ${selectedStrategy} y monto ${amount} USDT...`);
    
    try {
      const res = await fetch('http://31.97.253.128:3001/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: selectedStrategy, amount })
      });
      if (res.ok) {
        addLog("✅ Tarea registrada en el servidor. El backend tomará el control.");
        refreshOpenPositions();
      } else {
        addLog("❌ Error al registrar la tarea en el servidor.");
      }
    } catch (e) {
      addLog("❌ Error de red. No se pudo comunicar con el backend.");
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
              <span className="stat-label">Confianza IA</span>
              <span className="stat-value" style={{ color: aiConfidence > 75 ? '#3fb950' : '#d29922' }}>{aiConfidence}%</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Volumen (1m)</span>
              <span className="stat-value">{currentVol.toFixed(4)}</span>
            </div>
            {trailingStop && (
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
          <div className="strategy-selector">
            <div className="card-header" style={{ border: 'none', paddingBottom: 0, marginBottom: 0 }}>
              <FiClock /> <h4>Seleccionar Estrategia</h4>
            </div>
         <div className="strategy-options">
  {(['5m', '4h', '6h'] as StrategyKey[]).map(s => (
    <button
      key={s}
      className={`strategy-btn ${selectedStrategy === s ? 'active' : ''}`}
      onClick={() => setSelectedStrategy(s)}
    >
      {s}
    </button>
  ))}
</div>
            <div className="amount-group">
              <label className="amount-label">Monto para {selectedStrategy} (USDT)</label>
              <input 
                type="text" 
                value={strategyAmounts[selectedStrategy]} 
                onChange={e => setStrategyAmounts(prev => ({ ...prev, [selectedStrategy]: e.target.value }))} 
                className="trader-v2-input" />
            </div>
          </div>
          <button onClick={handleStartBot} disabled={botStatus !== 'IDLE'} className="btn-operate">
            <FiPlay /> OPERAR ESTRATEGIA
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
        <div className="process-grid">
          <div className="process-item">
            <span className="process-label">Estado del Bot</span>
            <span className="process-status highlight">
              {botStatus === 'ANALYZING_MARKET' ? 'ANALIZANDO MERCADO' :
               botStatus === 'WAITING_PULLBACK' ? 'ESPERANDO SEÑAL' :
               botStatus === 'IN_POSITION' ? 'EN OPERACIÓN' :
               botStatus}
            </span>
          </div>
          <div className="process-item">
            <span className="process-label">Fase de Mercado (IA)</span>
            <span className="process-status">
              {marketPhase}
            </span>
          </div>
          <div className="process-item">
            <span className="process-label">Análisis IA</span>
            <span className={`process-status ${isAiAnalyzing ? 'loading' : ''}`}>
              {isAiAnalyzing ? "PROCESANDO..." : aiAnalysis?.reason || "En espera"}
            </span>
          </div>
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
