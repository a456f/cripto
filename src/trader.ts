// c:\Users\ANTHONY\Downloads\sistema_crip\src\trader.ts

/**
 * Places an order via the backend server.
 * @param side - 'buy' or 'sell'.
 * @param size - The quantity to trade. For SPOT market buy, this is quote currency (USDT). For sell, it's base currency (BTC).
 * @returns The result from the server.
 */
export const placeOrder = async (side: 'buy' | 'sell', size: string): Promise<any> => {
  try {
    const response = await fetch('http://31.97.253.128:3001/api/place-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ side, size }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      return { code: 'FETCH_ERROR', msg: errorData.error || `HTTP error! status: ${response.status}` };
    }

    return await response.json();
  } catch (error: any) {
    console.error("Error placing order:", error);
    return { code: 'NETWORK_ERROR', msg: error.message || 'A network error occurred.' };
  }
};