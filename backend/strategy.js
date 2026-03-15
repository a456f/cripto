// backend/strategy.js
const { SMA, RSI, MACD, ATR } = require('technicalindicators');

// Configuración
const MIN_CANDLES = 50;

// Helpers
const getCloses = (candles) => candles.map(c => c.close).reverse();
const getHighs = (candles) => candles.map(c => c.high).reverse();
const getLows = (candles) => candles.map(c => c.low).reverse();
const getVolumes = (candles) => candles.map(c => c.volume).reverse();

const getTrend = (closes) => {
    if (closes.length < 20) return 'NEUTRAL';
    const lastClose = closes[closes.length - 1];
    const twentyClosesAgo = closes[closes.length - 20];
    if (lastClose > twentyClosesAgo) return 'BULLISH';
    if (lastClose < twentyClosesAgo) return 'BEARISH';
    return 'NEUTRAL';
};

const getVolumeConfirmation = (trend, closes, volumes) => {
    if (volumes.length < 10) return 'NO_CONFIRMATION';
    const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const lastVolume = volumes[volumes.length - 1];
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];

    if (trend === 'BULLISH' && lastClose > prevClose && lastVolume > avgVolume) return 'CONFIRMATION';
    if (trend === 'BEARISH' && lastClose < prevClose && lastVolume > avgVolume) return 'CONFIRMATION';
    
    return 'NO_CONFIRMATION';
};

const getSignalForTimeframe = (candles) => {
  const neutralState = { trend: 'NEUTRAL', volume: 'NO_CONFIRMATION', sma: 'NEUTRAL', rsi: 'NEUTRAL', macd: 'NEUTRAL', atr: 0, score: 0, timeframeBias: 'NEUTRAL', close: 0 };
  
  if (!candles || candles.length < MIN_CANDLES) {
    return neutralState;
  }

  const closes = getCloses(candles);
  const highs = getHighs(candles);
  const lows = getLows(candles);
  const volumes = getVolumes(candles);
  const lastClose = closes[closes.length - 1] || 0;

  let score = 0;

  // 1. Trend
  const trend = getTrend(closes);
  if (trend === 'BULLISH') score++;
  if (trend === 'BEARISH') score--;

  // 2. Volume
  const volume = getVolumeConfirmation(trend, closes, volumes);
  if (volume === 'CONFIRMATION') {
      if (trend === 'BULLISH') score++;
      if (trend === 'BEARISH') score--;
  }

  // 3. SMA
  const sma50 = SMA.calculate({ period: 50, values: closes });
  const sma100 = SMA.calculate({ period: 100, values: closes });
  const lastSma50 = sma50[sma50.length - 1];
  const lastSma100 = sma100[sma100.length - 1];
  let smaSignal = 'NEUTRAL';
  if (lastSma50 > lastSma100) {
      smaSignal = 'BULLISH';
      score++;
  } else if (lastSma50 < lastSma100) {
      smaSignal = 'BEARISH';
      score--;
  }

  // 4. RSI
  const rsiValues = RSI.calculate({ period: 14, values: closes });
  const lastRsi = rsiValues[rsiValues.length - 1];
  let rsiSignal = 'NEUTRAL';
  if (lastRsi > 55) {
      rsiSignal = 'BULLISH';
      score++;
  } else if (lastRsi < 45) {
      rsiSignal = 'BEARISH';
      score--;
  }

  // 5. MACD
  const macdInput = { values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false };
  const macdValues = MACD.calculate(macdInput);
  const lastMacd = macdValues[macdValues.length - 1];
  let macdSignal = 'NEUTRAL';
  if (lastMacd && lastMacd.MACD !== undefined && lastMacd.signal !== undefined) {
    if (lastMacd.MACD > lastMacd.signal) {
        macdSignal = 'BULLISH';
        score++;
    } else if (lastMacd.MACD < lastMacd.signal) {
        macdSignal = 'BEARISH';
        score--;
    }
  }
  
  // 6. ATR
  const atrInput = { high: highs, low: lows, close: closes, period: 14 };
  const atrValues = ATR.calculate(atrInput);
  const lastAtr = atrValues[atrValues.length - 1] || 0;

  let timeframeBias = 'NEUTRAL';
  if (score >= 1) timeframeBias = 'BULLISH';
  if (score <= -1) timeframeBias = 'BEARISH';

  return { trend, volume, sma: smaSignal, rsi: rsiSignal, macd: macdSignal, atr: lastAtr, score, timeframeBias, close: lastClose };
};

const getFinalSignal = (signals, tradeMode) => {
  const fourHour = signals['4h'];
  const oneHour = signals['1h'];
  const fiveMin = signals['5m'];

  const scoreThreshold = {
    conservative: 4,
    balanced: 3,
    aggressive: 2,
  }[tradeMode];

  // Volatility Filter
  const atrThreshold = fiveMin.close * 0.0005; 
  if (fiveMin.atr > 0 && fiveMin.atr < atrThreshold) {
      return 'WAIT';
  }

  // LONG
  if (fourHour.timeframeBias === 'BULLISH' && oneHour.timeframeBias !== 'BEARISH' && fiveMin.score >= scoreThreshold) {
    return 'EXECUTE_LONG';
  }

  // SHORT (Venta en spot si tuviéramos lógica de short, o venta de tenencias)
  if (fourHour.timeframeBias === 'BEARISH' && oneHour.timeframeBias !== 'BULLISH' && fiveMin.score <= -scoreThreshold) {
    return 'EXECUTE_SHORT';
  }

  return 'WAIT';
};

module.exports = { getSignalForTimeframe, getFinalSignal };
