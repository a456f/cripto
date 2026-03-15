// c:\Users\ANTHONY\Downloads\sistema_crip\src\riskManager.ts

/**
 * Calculates the position size in USDT based on balance and risk parameters.
 * @param balance - The total balance available for trading.
 * @param riskPercent - The percentage of the balance to risk on a single trade (e.g., 0.10 for 10%).
 * @param stopPercent - The stop loss percentage for the trade (e.g., 0.02 for 2%).
 * @returns The calculated position size in USDT.
 */
export const calculatePositionSize = (
  balance: number,
  riskPercent: number,
  stopPercent: number
): number => {
  if (balance <= 0 || riskPercent <= 0 || stopPercent <= 0) {
    return 0;
  }

  const riskAmount = balance * riskPercent;
  let positionSize = riskAmount / stopPercent;

  // Ensure position size does not exceed total balance
  positionSize = Math.min(positionSize, balance);

  return positionSize;
};