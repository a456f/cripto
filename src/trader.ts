// c:\Users\ANTHONY\Downloads\sistema_crip\src\trader.ts
export const placeOrder = async (side: 'buy' | 'sell', size: string) => {
    // This function proxies the request to the local server,
    // which should securely handle the API keys and signing.
    try {
        // The original implementation in BitgetTraderV2.tsx used this endpoint.
        // We assume a local proxy is running.
        const res = await fetch('http://31.97.253.128:3001/api/place-order', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                side,
                size
            })
        });

        if (!res.ok) {
            const errorData = await res.json();
            return { code: 'ERROR', msg: errorData.msg || `HTTP error! status: ${res.status}` };
        }
        return await res.json();
    } catch (e: any) {
        return { code: 'ERROR', msg: `Network Error: ${e.message}` };
    }
};