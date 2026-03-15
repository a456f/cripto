export const analyzeMarketWithAI = async (history: any[]) => {
  // Enviamos 10 velas para mejor contexto
  const summary = history.slice(0, 10).map((c, i) => 
    `V${i}: C:${c.close} H:${c.high} L:${c.low} V:${c.volume}`
  ).join(' | ');

  try {
    const response = await fetch('/local-server/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    return { decision: "WAIT", reason: "Error de red con servidor local", confidence: 0 };
  }
};