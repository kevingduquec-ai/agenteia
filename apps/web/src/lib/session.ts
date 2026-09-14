const STORAGE_KEY = 'prefiero-ia:anonymous-session-id';

/**
 * Cada visitante tiene un id anonimo generado en el navegador (nunca
 * requiere login) — se guarda en localStorage para que la conversacion
 * siga existiendo si vuelve a entrar. Ver seccion 52 del documento
 * maestro: el proveedor de IA nunca necesita saber quien es la persona.
 */
export function getOrCreateAnonymousSessionId(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const id = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
