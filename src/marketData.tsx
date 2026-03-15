// marketData.js
// Responsabilidad: Gestionar el flujo de datos en tiempo real.

export interface Candle {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export const processStream = (lastMessage: any): Candle | null => {
    // Validamos que el mensaje sea una vela válida de Bitget
    if (!lastMessage || lastMessage.arg?.channel !== 'candle1m' || !Array.isArray(lastMessage.data) || lastMessage.data.length === 0) {
        return null;
    }

    const candle = lastMessage.data[0];
    return {
        timestamp: candle[0],
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[5])
    };
};
