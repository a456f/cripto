// c:\Users\ANTHONY\Downloads\sistema_crip\src\riskManager.ts
/**
 * Calculates the position size based on account balance, risk, and stop loss.
 * NOTE: For SPOT trading, leverage is 1. The position size is the amount of USDT to use.
 * @param accountBalance - Total available capital in USDT.
 * @param riskPercent - The percentage of the account to risk (e.g., 0.1 for 10%).
 * @param stopLossPercent - The percentage drop for the stop loss (e.g., 0.02 for 2%).
 * @returns The size of the position in USDT.
 */
export const calculatePositionSize = (
    accountBalance: number,
    riskPercent: number = 0.10, // 10% risk
    stopLossPercent: number = 0.02 // 2% SL
): number => {
    if (stopLossPercent <= 0) {
        throw new Error("Stop loss percent must be greater than 0.");
    }
    const riskAmount = accountBalance * riskPercent;
    // For spot, the position size is the amount you risk divided by how much you could lose per dollar invested.
    return riskAmount / stopLossPercent;
};
