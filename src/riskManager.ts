export const calculatePositionSize = (
  balance: number,
  currentPrice: number,
  stopLossPrice: number,
  riskPercentage: number = 0.01 // 1% de riesgo por defecto
): string => {
  if (balance <= 0 || currentPrice <= 0) return "0";

  const riskAmount = balance * riskPercentage;
  const stopLossDistance = currentPrice - stopLossPrice;

  // Evitamos división por cero o Stop Loss por encima del precio en un LONG
  if (stopLossDistance <= 0) return "10.00"; 

  // Porcentaje de caída necesaria para tocar el SL
  const riskPerTokenPercent = stopLossDistance / currentPrice;
  const sizeInUsdt = riskAmount / riskPerTokenPercent;

  // Cap al 95% del balance para cubrir comisiones (Taker fees ~0.1%)
  const finalSize = Math.min(sizeInUsdt, balance * 0.95);
  return finalSize.toFixed(2);
};
