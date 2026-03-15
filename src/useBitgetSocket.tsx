import { useState, useEffect, useRef } from 'react';

const WEBSOCKET_URL = 'wss://ws.bitget.com/v2/ws/public';
const RECONNECT_TIMEOUT = 5000;
const PING_INTERVAL = 20000;

export type ConnectionStatus = 'Connecting' | 'Connected' | 'Disconnected' | 'Error';

interface SubscriptionArg {
  instType: 'SPOT';
  channel: string;
  instId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface WebSocketMessage<T = any> {
  action: 'snapshot' | 'update';
  arg: SubscriptionArg;
  data: T;
  ts: string;
}
/* eslint-disable */
export const useBitgetSocket = (subscriptions: SubscriptionArg[]) => {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('Connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Usamos una ref para rastrear si el desmontaje fue intencional
    // y así no intentar reconectar en ese caso.
    const isUnmounted = { current: false };

    const clearAllTimers = () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current); // Corrección de typo aquí
        pingIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const connect = () => {
      // No conectar si ya hay una conexión o si el componente se desmontó
      if (isUnmounted.current || (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING)) {
        console.log('WebSocket ya está conectado o conectándose.');
        return;
      }

      clearAllTimers(); // Limpia cualquier temporizador pendiente antes de conectar

      setConnectionStatus('Connecting');
      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted.current) return;
        console.log('Conectado a Bitget WebSocket');
        setConnectionStatus('Connected');
        // Enviar suscripciones
        ws.send(JSON.stringify({ op: 'subscribe', args: subscriptions }));

        // Iniciar ping para mantener la conexión
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (event) => {
        if (isUnmounted.current || event.data === 'pong') return;
        try {
          const message = JSON.parse(event.data);
          // A veces la API envía eventos sin 'arg', como la confirmación de login
          if (message.arg || message.event) {
            setLastMessage(message);
          }
        } catch (error: any) {
          console.error('Error al procesar el mensaje del WebSocket:', error);
        }
      };

      ws.onerror = (error) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (isUnmounted.current) return;
        console.error('Error de WebSocket:', error);
        setConnectionStatus('Error');
        // onerror es seguido inmediatamente por onclose, que maneja la reconexión.
      };

      ws.onclose = () => {
        if (isUnmounted.current) return; // No reconectar si el componente se desmontó
        console.log('WebSocket desconectado. Intentando reconectar...');
        setConnectionStatus('Disconnected');
        clearAllTimers(); // Limpia el ping

        // Intenta reconectar después de un tiempo
        reconnectTimeoutRef.current = window.setTimeout(connect, RECONNECT_TIMEOUT);
      };
    };

    connect();

    return () => {
      isUnmounted.current = true;
      clearAllTimers();
      if (wsRef.current) {
        // Desvincula los manejadores para evitar que se ejecuten durante el cierre
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [JSON.stringify(subscriptions)]); // Vuelve a conectar si las suscripciones cambian

  return { lastMessage, connectionStatus };
};
/* eslint-enable */