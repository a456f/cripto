// c:\Users\ANTHONY\Downloads\sistema_crip\src\BitgetTraderV2.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FiKey, FiLock, FiShield, FiDollarSign, FiActivity, FiTerminal, FiSettings, FiPlay, FiTrendingUp, FiCheckCircle, FiBriefcase, FiTarget, FiInfo, FiCpu, FiList, FiXCircle, FiClock } from 'react-icons/fi';
import CryptoJS from 'crypto-js';
import { useBitgetSocket, type WebSocketMessage } from './useBitgetSocket';
import { processStream, type Candle } from './marketData';
import { placeOrder } from './trader';
import './BitgetTraderV2.css';

type BotStatus =
  | 'IDLE' | 'ANALYZING' | 'BUYING' | 'IN_POSITION' | 'TRAILING_ACTIVE' | 'EXITING';


const BitgetTraderV2: React.FC = () => {
  // --- ESTADOS DE CREDENCIALES ---
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_BITGET_API_KEY || '');
  const [secretKey, setSecretKey] = useState(import.meta.env.VITE_BITGET_SECRET_KEY || '');
  const [passphrase, setPassphrase] = useState(import.meta.env.VITE_BITGET_PASSPHRASE || '');
  const [anthropicKey, setAnthropicKey] = useState(import.meta.env.VITE_CLAUDE_API_KEY || '');

  // --- ESTADOS DEL BOT ---
  const [botStatus, setBotStatus] = useState<BotStatus>('IDLE');
  const [tradeMode, setTradeMode] = useState<'conservative' | 'balanced' | 'aggressive' | 'scalping'>('balanced');
  const [logs, setLogs] = useState<string[]>([]);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [trailingStop, setTrailingStop] = useState<number | null>(null);
  const [unrealizedPnl, setUnrealizedPnl] = useState({ percent: 0, usdt: 0 });
  const [botBalance, setBotBalance] = useState<number>(1000); // Balance simulado para riskManager
  const [openPositions, setOpenPositions] = useState<any[]>([]);
  const [recentTrades, setRecentTrades] = useState<any[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const currentTaskIdRef = useRef<string | null>(null);
  const [timeframeAnalyses, setTimeframeAnalyses] = useState<any>({
    '5m': {},
    '1h': {},
    '4h': {},
  });

  // --- REFERENCIAS PARA ESTRATEGIA ---
  const candles1m = useRef<Candle[]>([]);
  const candles5m = useRef<Candle[]>([]);
  const candles1h = useRef<Candle[]>([]);
  const candles4h = useRef<Candle[]>([]);
  const lastTradeTimestampRef = useRef<number>(0);
  const tradesTodayCountRef = useRef<number>(0);

  // Usar useMemo para evitar que el socket se reconecte en cada renderizado
  const socketConfig = useMemo(() => [
    { instType: 'SPOT' as const, channel: 'candle1m', instId: 'BTCUSDT' }
  ], []);

  const { lastMessage, connectionStatus } = useBitgetSocket(socketConfig);
  const [isServerAlive, setIsServerAlive] = useState(false);
  const addLog = (msg: string) => {
    const timeMsg = `[${new Date().toLocaleTimeString()}] ${msg}`;
    setLogs(prev => [timeMsg, ...prev].slice(0, 50));

    // Si hay una tarea iniciada, enviamos el log al servidor para el TXT final
    if (currentTaskIdRef.current && msg.includes("Cierre manual")) { 
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
      // Solo verificamos si el servidor responde, ya no enviamos el estado desde aquí
      // porque el estado verdadero vive en el servidor.
      fetch('http://31.97.253.128:3001/api/status', {
        method: 'GET',
      })
      .then(() => setIsServerAlive(true))
      .catch(() => setIsServerAlive(false));
    };

    checkHeartbeat(); // Verificar al montar
    refreshBalance(); // Cargar balance al inicio
    const hbInterval = setInterval(checkHeartbeat, 10000);
    // Polling del estado del bot del servidor
    const botStatusInterval = setInterval(syncBotStatus, 2000); 
    const posInterval = setInterval(refreshOpenPositions, 5000);
    const balanceInterval = setInterval(refreshBalance, 15000); // Refrescar balance cada 15s

    return () => {
      clearInterval(hbInterval);
      clearInterval(botStatusInterval);
      clearInterval(posInterval);
      clearInterval(balanceInterval);
    };
  }, []);

  // --- SINCRONIZAR ESTADO CON EL BACKEND ---
  const syncBotStatus = async () => {
    try {
      const res = await fetch('http://31.97.253.128:3001/api/bot/status');
      if (res.ok) {
        const remoteState = await res.json();
        
        // Sincronizar estado visual con el estado del backend
        if (remoteState.status !== botStatus) {
            setBotStatus(remoteState.status);
        }
        // Sincronizar logs con los del backend
        if (remoteState.logs && remoteState.logs.length > 0) {
            // El servidor envía los logs con el más nuevo primero, lo que coincide con nuestro estado.
            setLogs(remoteState.logs);
        }

        if (remoteState.trailingStop) setTrailingStop(remoteState.trailingStop);
        // Opcional: Si el backend envía análisis, actualizar timeframeAnalyses
        // if (remoteState.analyses) setTimeframeAnalyses(remoteState.analyses);
      }
    } catch (e) {
      // Error silencioso en polling
    }
  };

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

  // --- LÓGICA DE SALIDA CENTRALIZADA ---
  const handleExitPosition = async (reasonMsg: string, price: number) => {
    addLog(`${reasonMsg} Finalizando proceso y cerrando tarea...`);
    
    // Intentamos detener el bot en el backend primero si estaba corriendo
    await fetch('http://31.97.253.128:3001/api/bot/stop', { method: 'POST' });

    // Para cierre manual, necesitamos saber cuánto vender.
    // En un sistema puro de backend, el backend sabría esto.
    // Aquí hacemos una venta de pánico de todo lo que tengamos o usamos un endpoint de cierre de emergencia.
    // Como fallback, usamos una cantidad pequeña o consultamos el balance de BTC.
    const btcToSell = 0; // TODO: Fetch from balance or backend position state
    if (btcToSell <= 0) {
        addLog("ℹ️ Solicitando al servidor cerrar posición abierta...");
        // En este nuevo modelo, llamar a STOP en el backend debería cerrar la posición si el backend tiene esa lógica.
        setBotStatus('IDLE');
        setTrailingStop(null);
        return;
    }

    addLog(`💸 Intentando vender ${btcToSell.toFixed(6)} BTC...`);
    const res = await placeOrder('sell', btcToSell.toString());
    setBotStatus('IDLE');
    setTrailingStop(null);
    
    await fetch('http://31.97.253.128:3001/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side: 'sell', price, amount: btcToSell * price, orderId: res.data?.orderId })
    });
    
    refreshTrades();
    refreshOpenPositions();
  };

  // --- FUNCIÓN DE PÁNICO (FRENO DE MANO) ---
  const handlePanicStop = async () => {
    const confirm = window.confirm("🚨 ¿ACTIVAR FRENO DE EMERGENCIA?\n\nEsto venderá TODAS las posiciones a mercado y detendrá el bot inmediatamente.\n¿Estás seguro?");
    if (!confirm) return;

    addLog("🚨 ¡ENVIANDO SEÑAL DE PÁNICO AL SERVIDOR! 🚨");
    try {
      const res = await fetch('http://31.97.253.128:3001/api/bot/panic', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        addLog(`🛑 ${data.message}`);
        setBotStatus('IDLE');
        setTrailingStop(null);
      } else {
        addLog("❌ Error: El servidor no pudo ejecutar el freno de mano.");
      }
    } catch (e) {
      addLog("❌ Error CRÍTICO de conexión al intentar frenar.");
    }
  };

  // --- SOLO VISUALIZACIÓN (WEBSOCKET) ---
  useEffect(() => {
    if (!lastMessage) return;

    const newCandleData = processStream(lastMessage);
    if (!newCandleData) return;

    setCurrentPrice(newCandleData.close);

    // Ya no calculamos PnL ni Trailing Stop aquí.
    // El backend se encarga de eso.
    // Podemos mostrar el precio en tiempo real, pero la lógica está desconectada.
  }, [lastMessage, botStatus, trailingStop]);

  useEffect(() => {
    refreshTrades();
    refreshOpenPositions();
  }, []);

  const handleStartBot = async () => {
    if (botStatus === 'IDLE') {
        addLog("🚀 Enviando comando de inicio al servidor...");
        try {
            const res = await fetch('http://31.97.253.128:3001/api/bot/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tradeMode })
            });
            if (res.ok) {
                addLog(`✅ Servidor confirmó inicio. El bot correrá 24/7.`);
                // El polling actualizará el estado a ANALYZING
                setBotStatus('ANALYZING');
            } else {
                const err = await res.json();
                addLog(`❌ Error del servidor: ${err.error || err.message}`);
            }
        } catch (e) {
            addLog("❌ Error de red. No se pudo comunicar con el backend.");
        }
    } else {
        addLog("🛑 Enviando comando de parada al servidor...");
        try {
            const res = await fetch('http://31.97.253.128:3001/api/bot/stop', { method: 'POST' });
            if (res.ok) {
                addLog("✅ Bot detenido en el servidor.");
                setBotStatus('IDLE');
            } else {
                addLog("⚠️ El servidor reportó un problema al detener.");
            }
        } catch (e) {
            addLog("❌ Error de red al intentar detener.");
        }
    }
  };

  return (
    <div className="trader-v2-container">
      <div className="trader-header">
        <div className="title-section">
          <FiActivity className="icon-pulse" />
          <h2 className="trader-v2-title">Bitget Algorithmic Bot V2.0</h2>
        </div>
        <div className="status-badge remote-mode-badge">
            <FiCpu />
            <span>Modo: Remoto</span>
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
            <FiSettings /> <h3>Parámetros de Trading</h3>
          </div>
          <div className="trade-mode-selector">
            <span>Modo de Riesgo:</span>
            <div className="radio-group">
                {(['conservative', 'balanced', 'aggressive', 'scalping'] as const).map(mode => (
                    <label key={mode}>
                        <input
                            type="radio"
                            name="tradeMode"
                            value={mode}
                            checked={tradeMode === mode}
                            onChange={() => setTradeMode(mode)}
                        />
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </label>
                ))}
            </div>
          </div>
          <div className="risk-params">
            {tradeMode === 'scalping' ? (
                <>
                    <div className="param-item"><span>Estrategia:</span> <span>Scalping de alta frecuencia</span></div>
                    <div className="param-item"><span>Entrada:</span> <span>Dip desde máximo reciente (0.2%)</span></div>
                    <div className="param-item"><span>Salida (TP):</span> <span>+0.5% Ganancia</span></div>
                </>
            ) : (
                <>
                    <div className="param-item"><span>Riesgo por Op.:</span> <span>10%</span></div>
                    <div className="param-item"><span>Trades/Día:</span> <span>{{ conservative: 3, balanced: 6, aggressive: 10 }[tradeMode]}</span></div>
                    <div className="param-item"><span>Score Mínimo:</span> <span>{{ conservative: 4, balanced: 3, aggressive: 2 }[tradeMode]}</span></div>
                </>
            )}
          </div>
          <button 
            onClick={handleStartBot} 
            className={`btn-operate ${botStatus !== 'IDLE' ? 'active' : ''}`}
            disabled={botStatus === 'BUYING' || botStatus === 'EXITING'}
          >
            <FiPlay /> 
            {botStatus === 'IDLE' ? 'INICIAR BOT' : 'DETENER BOT'}
          </button>

          {botStatus !== 'IDLE' && (
              <button 
                onClick={handlePanicStop} 
                className="btn-operate"
                style={{ 
                  marginTop: '15px', 
                  backgroundColor: '#dc3545', 
                  color: 'white', 
                  border: '2px solid #b02a37',
                  fontWeight: 'bold',
                  letterSpacing: '1px',
                  boxShadow: '0 4px 12px rgba(220, 53, 69, 0.4)',
                  padding: '12px',
                  textTransform: 'uppercase'
                }}
              >
                <FiXCircle style={{ marginRight: '8px', fontSize: '1.2em' }} /> FRENO DE EMERGENCIA
              </button>
          )}
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
              <div className={`timeframe-signal ${timeframeAnalyses[tf]?.timeframeBias}`}>
                {timeframeAnalyses[tf]?.timeframeBias || 'NEUTRAL'}
              </div>
              <div className="timeframe-indicators">
                Score: {timeframeAnalyses[tf]?.score ?? 'N/A'}
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
