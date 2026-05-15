/**
 * ESP32-CAM API wrappers
 */

export async function sendControl(
  baseUrl: string,
  params: Record<string, string>
) {
  const qs = new URLSearchParams(params).toString();
  return fetch(`${baseUrl}/control?${qs}`, { method: "GET" }).catch(
    () => null
  );
}

export async function sendLED(baseUrl: string, state: "on" | "off") {
  return sendControl(baseUrl, { led: state });
}

export async function sendESP32Command(baseUrl: string, direction: "left" | "right" | "center") {
  return sendControl(baseUrl, { servo: direction });
}

export async function checkHeartbeat(baseUrl: string): Promise<{
  alive: boolean;
  uptime?: number;
  clients?: number;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${baseUrl}/heartbeat`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      return await res.json();
    }
    return { alive: false };
  } catch {
    return { alive: false };
  }
}