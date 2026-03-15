import BitgetTraderV2 from './BitgetTraderV2'
import React, { useState, useEffect, useRef } from 'react'
import './App.css'
import { FiGrid, FiBarChart2, FiTrendingUp, FiPocket, FiSearch, FiBell, FiDollarSign, FiBriefcase } from 'react-icons/fi';
import { useBitgetSocket, type WebSocketMessage } from './useBitgetSocket';
import * as LightweightCharts from 'lightweight-charts';
import type { IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';

const ANIMATION_DURATION = 700 // ms

const SUBSCRIPTIONS = [
  {
    instType: 'SPOT' as const,
    channel: 'ticker',
    instId: 'BTCUSDT',
  },
  { instType: 'SPOT' as const, channel: 'ticker', instId: 'ETHUSDT' },
  { instType: 'SPOT' as const, channel: 'ticker', instId: 'SOLUSDT' },
  { instType: 'SPOT' as const, channel: 'ticker', instId: 'BNBUSDT' },
  { instType: 'SPOT' as const, channel: 'candle1m', instId: 'BTCUSDT' },
];

interface TickerData {
  price: string;
  change24h: string;
}

// --- MÓDULO 0: SIDEBAR ---
interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => (
  <aside className="sidebar">
    <div className="sidebar-header">
      <div className="logo">CriptoSys</div>
    </div>
    <nav className="sidebar-nav">
      <button 
        onClick={() => setActiveTab('dashboard')} 
        className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
      >
        <FiGrid />
        <span>Dashboard</span>
      </button>
      <button className="nav-item">
        <FiBarChart2 />
        <span>Mercados</span>
      </button>
      <button 
        onClick={() => setActiveTab('trading')} 
        className={`nav-item ${activeTab === 'trading' ? 'active' : ''}`}
      >
        <FiTrendingUp />
        <span>Trading</span>
      </button>
      <button className="nav-item">
        <FiPocket />
        <span>Billetera</span>
      </button>
    </nav>
  </aside>
);

// --- MÓDULO 1: HEADER ---
const Header = () => (
  <header className="dashboard-header">
    <div className="header-left">
      <div className="search-bar">
        <FiSearch />
        <input type="text" placeholder="Buscar criptomoneda..." />
      </div>
    </div>
    <div className="header-right">
      <button className="icon-button">
        <FiBell />
      </button>
      <div className="user-avatar">
        <img src="https://i.pravatar.cc/40" alt="User Avatar" />
      </div>
    </div>
  </header>
);

// --- MÓDULO 2: TARJETAS KPI ---
interface KpiCardProps {
  icon: React.ReactNode;
  title: string;
  value: React.ReactNode;
  change?: string;
  changeType?: 'positive' | 'negative';
}

const KpiCard: React.FC<KpiCardProps> = ({ icon, title, value, change, changeType }) => (
  <div className="kpi-card">
    <div className="kpi-icon">{icon}</div>
    <div className="kpi-title">{title}</div>
    <div className="kpi-value">{value}</div>
    {change && <div className={`kpi-change ${changeType}`}>{change}</div>}
  </div>
);

// --- MÓDULO 3: TABLA DE CRIPTOMONEDAS ---
interface CryptoData {
  name: string;
  symbol: string;
  price: number;
  change: number;
  volume: string;
}

interface CryptoTableProps {
  data: CryptoData[];
  priceChangeClasses: { [key: string]: string };
}

const initialCryptoData: CryptoData[] = [
  { name: 'Bitcoin', symbol: 'BTC', price: 68123.45, change: 1.25, volume: '35.4B' },
  { name: 'Ethereum', symbol: 'ETH', price: 3567.89, change: -0.82, volume: '18.2B' },
  { name: 'Solana', symbol: 'SOL', price: 150.11, change: 3.40, volume: '4.1B' },
  { name: 'BNB', symbol: 'BNB', price: 589.50, change: -2.15, volume: '2.5B' },
];

const CryptoTable: React.FC<CryptoTableProps> = ({ data, priceChangeClasses }) => (
  <div className="data-module">
    <h3>Mercado</h3>
    <table className="crypto-table">
      <thead>
        <tr>
          <th>Activo</th>
          <th className="align-right">Precio</th>
          <th className="align-right">Cambio 24h</th>
          <th className="align-right">Volumen</th>
        </tr>
      </thead>
      <tbody>
        {data.map(crypto => {
          const instId = `${crypto.symbol}USDT`;
          const priceChangeClass = priceChangeClasses[instId] || '';
          return (
            <tr key={crypto.symbol}>
            <td>
              <div className="crypto-name">
                {crypto.name} <span className="symbol">{crypto.symbol}</span>
              </div>
            </td>
            <td className={`align-right ${priceChangeClass}`}>${crypto.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td className={`align-right ${crypto.change >= 0 ? 'text-green' : 'text-red'}`}>
              {crypto.change >= 0 ? '+' : ''}{crypto.change.toFixed(2)}%
            </td>
            <td className="align-right">${crypto.volume}</td>
          </tr>
        )})}
      </tbody>
    </table>
  </div>
);

// --- MÓDULO 4: GRÁFICO DE VELAS ---
interface ChartProps {
  data: CandlestickData<Time>[];
}

const CandlestickChart: React.FC<ChartProps> = ({ data }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    const chartContainer = chartContainerRef.current;
    if (!chartContainer) {
      return;
    }

    const chart = LightweightCharts.createChart(chartContainer, {
      width: chartContainer.clientWidth,
      height: 350,
      layout: {
        background: { color: '#0d1117' },
        textColor: '#c9d1d9',
      },
      grid: {
        vertLines: { color: '#30363d' },
        horzLines: { color: '#30363d' },
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
        secondsVisible: false,
      },
    });
    chartRef.current = chart;

    const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: '#0ecb81',
      downColor: '#f6465d',
      borderDownColor: '#f6465d',
      borderUpColor: '#0ecb81',
      wickDownColor: '#f6465d',
      wickUpColor: '#0ecb81',
    });
    seriesRef.current = series;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (seriesRef.current && data.length > 0) {
      seriesRef.current.setData(data);
    }
  }, [data]);

  return <div ref={chartContainerRef} style={{ width: '100%', height: '350px' }} />;
};

// Simulación de datos históricos para el gráfico
const generateInitialCandleData = (): CandlestickData<Time>[] => {
  const data: CandlestickData<Time>[] = [];
  let time = Math.floor(Date.now() / 1000) - 60 * 60; // Hace una hora
  let price = 68000;
  for (let i = 0; i < 60; i++) {
    const open = price;
    const close = open + (Math.random() - 0.5) * 100;
    const high = Math.max(open, close) + Math.random() * 50;
    const low = Math.min(open, close) - Math.random() * 50;
    data.push({ time: time as Time, open, high, low, close });
    price = close;
    time += 60; // Siguiente minuto
  }
  return data;
}

function App() {
  const [tickers, setTickers] = useState<{ [key: string]: TickerData }>({});
  const [priceChangeClasses, setPriceChangeClasses] = useState<{ [key: string]: string }>({});
  const [cryptoTableData, setCryptoTableData] = useState<CryptoData[]>(initialCryptoData);
  const [candleData, setCandleData] = useState<CandlestickData<Time>[]>([]);
  const [activeTab, setActiveTab] = useState('dashboard');

  const { lastMessage } = useBitgetSocket(SUBSCRIPTIONS);

  const prevPricesRef = useRef<{ [key: string]: string | null }>({});

  useEffect(() => {
    if (!lastMessage) return;

    const { arg, data } = lastMessage as WebSocketMessage;

    if (arg?.channel === 'ticker' && Array.isArray(data) && data[0] && typeof data[0] === 'object') {
      const tickerData = data[0];
      const instId = arg.instId;
      if (tickerData.lastPr && tickerData.open24h) { // Aseguramos que open24h exista
        const currentPriceStr = tickerData.lastPr;
        const currentPriceNum = parseFloat(currentPriceStr);
        const openPriceStr = tickerData.open24h;
        let changePercent = '0.00';
        const openPriceNum = parseFloat(openPriceStr);

        if (!isNaN(currentPriceNum) && !isNaN(openPriceNum) && openPriceNum !== 0) { // Manejo de NaN y división por cero
          changePercent = (((currentPriceNum - openPriceNum) / openPriceNum) * 100).toFixed(2);
        }
        setTickers(prev => ({
          ...prev,
          [instId]: {
            price: currentPriceStr,
            change24h: changePercent,
          },
        }));

        // Actualizamos también los datos de la tabla
        setCryptoTableData(prevData =>
          prevData.map(crypto => {
            if (instId.startsWith(crypto.symbol)) {
              return {
                ...crypto,
                price: currentPriceNum,
                change: parseFloat(changePercent),
              };
            }
            return crypto;
          })
        );
      }
    } else if (arg?.channel === 'candle1m' && Array.isArray(data) && Array.isArray(data[0])) {
      const candle = data[0];
      const newCandle: CandlestickData<Time> = {
        time: (parseInt(candle[0]) / 1000) as Time, // Convertir ms a segundos
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
      };

      setCandleData(prevData => {
        if (prevData.length === 0) return [newCandle];
        const lastDataPoint = prevData[prevData.length - 1];

        if (newCandle.time === lastDataPoint.time) {
          // Si el timestamp es el mismo, actualizamos la vela existente (mismo minuto)
          const newData = [...prevData];
          newData[newData.length - 1] = newCandle;
          return newData;
        } else if (newCandle.time > lastDataPoint.time) {
          // Solo añadimos si el tiempo es estrictamente posterior
          return [...prevData, newCandle];
        }
        // Si llega una vela con tiempo anterior (por lag o desajuste de reloj), la ignoramos para no romper el gráfico
        return prevData;
      });
    }
  }, [lastMessage]);

  // Efecto para establecer la clase de animación
  useEffect(() => {
    const newClasses: { [key: string]: string } = {};
    let needsUpdate = false;

    for (const instId in tickers) {
      const currentPrice = tickers[instId]?.price;
      const prevPrice = prevPricesRef.current[instId];

      if (currentPrice && prevPrice) {
        if (parseFloat(currentPrice) > parseFloat(prevPrice)) {
          newClasses[instId] = 'price-up';
          needsUpdate = true;
        } else if (parseFloat(currentPrice) < parseFloat(prevPrice)) {
          newClasses[instId] = 'price-down';
          needsUpdate = true;
        }
      }
      prevPricesRef.current[instId] = currentPrice;
    }

    if (needsUpdate) {
      setPriceChangeClasses(prev => ({ ...prev, ...newClasses }));
    }
  }, [tickers]);

  // Efecto para limpiar la clase de animación
  useEffect(() => {
    if (Object.keys(priceChangeClasses).length === 0) return;
    const timer = setTimeout(() => setPriceChangeClasses({}), ANIMATION_DURATION);
    return () => clearTimeout(timer)
  }, [priceChangeClasses]);

  // Cargar datos históricos simulados una vez
  useEffect(() => {
    setCandleData(generateInitialCandleData());
  }, []);

  return (
    <div className="dashboard-layout">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="main-wrapper">
        <Header />
        <main className="dashboard-main">
          {activeTab === 'dashboard' ? (
            <>
              <div className="kpi-grid">
                {SUBSCRIPTIONS.filter(sub => sub.channel === 'ticker').map(({ instId }) => {
                  const ticker = tickers[instId];
                  const priceChangeClass = priceChangeClasses[instId] || '';
                  const displayName = instId.replace('USDT', '');

                  return (
                    <KpiCard
                      key={instId}
                      icon={<FiDollarSign />}
                      title={`Precio ${displayName}`}
                      value={
                        ticker ? (
                          <span className={priceChangeClass}>
                            ${parseFloat(ticker.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          'Cargando...'
                        )
                      }
                      change={`${ticker?.change24h ?? '0.00'}% (24h)`}
                      changeType={ticker && parseFloat(ticker.change24h) >= 0 ? 'positive' : 'negative'}
                    />
                  );
                })}
                <KpiCard
                  icon={<FiBriefcase />}
                  title="Activos en Cartera"
                  value="8"
                />
              </div>
              <div className="main-content-grid">
                <div className="data-module">
                  <h3>BTC/USDT Gráfico 1m</h3>
                  <CandlestickChart data={candleData} />
                </div>
                <CryptoTable data={cryptoTableData} priceChangeClasses={priceChangeClasses} />
              </div>
            </>
          ) : (
            <div className="trading-view-container" style={{
              display: 'flex',
              justifyContent: 'center',
              paddingTop: '40px'
            }}>
              <BitgetTraderV2 />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App