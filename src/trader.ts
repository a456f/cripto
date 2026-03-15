import CryptoJS from 'crypto-js';

export interface Credentials {
    apiKey: string;
    secretKey: string;
    passphrase: string;
}

export const executeOrder = async (side: 'buy' | 'sell', symbol: string, size: string, credentials: Credentials) => {
    const { apiKey, secretKey, passphrase } = credentials;
    const timestamp = Date.now().toString();
    const path = '/api/v2/spot/trade/place-order';
    
    const body = JSON.stringify({
        symbol,
        side,
        orderType: 'market',
        size, // Bitget V2 usa 'size' para el monto en Market Orders
        force: 'gtc'
    });

    // Firma requerida por la API V2 de Bitget
    const signature = CryptoJS.HmacSHA256(timestamp + 'POST' + path + body, secretKey).toString(CryptoJS.enc.Base64);

try {

  const response = await fetch('/local-server/api/place-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      side,
      size
    })
  });

  return await response.json();

} catch (error: any) {

  return { code: 'ERROR', msg: error.message };

}
};