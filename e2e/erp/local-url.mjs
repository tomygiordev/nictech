export function localUrl(value, label, protocols = ['http:', 'https:']) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new Error(`${label}: falta una URL local válida.`);
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !protocols.includes(url.protocol)) {
    throw new Error(`${label}: solo se permite 127.0.0.1 o localhost.`);
  }
  return url;
}
