const API_BASE = 'https://api.decolecta.com/v1';

class ErrorConsultaDocumento extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** @param {string | number} numero @param {{ token?: string, fetchImpl?: typeof fetch }} [options] */
async function consultarDocumento(numero, options = {}) {
  const documento = String(numero).replace(/\D/g, '');
  const tipoDocumento = documento.length === 8 ? 'DNI' : documento.length === 11 ? 'RUC' : null;
  if (!tipoDocumento) {
    throw new ErrorConsultaDocumento('Ingresa un DNI de 8 dígitos o un RUC de 11 dígitos', 400);
  }

  const token = options.token ?? process.env.DECOLECTA_API_TOKEN;
  if (!token) {
    throw new ErrorConsultaDocumento('Configura DECOLECTA_API_TOKEN para habilitar la consulta de documentos', 503);
  }

  const servicio = tipoDocumento === 'DNI' ? 'reniec/dni' : 'sunat/ruc';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(`${API_BASE}/${servicio}?numero=${documento}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new ErrorConsultaDocumento('El servicio de consulta no está disponible; intenta nuevamente', 503);
  }

  if (!response.ok) {
    if ([400, 404, 422].includes(response.status)) {
      throw new ErrorConsultaDocumento('No se encontró información para ese documento', 404);
    }
    if ([401, 403].includes(response.status)) {
      throw new ErrorConsultaDocumento('El proveedor rechazó el token de consulta', 503);
    }
    if (response.status === 429) {
      throw new ErrorConsultaDocumento('Se alcanzó el límite de consultas del proveedor', 503);
    }
    throw new ErrorConsultaDocumento('El proveedor no pudo completar la consulta', 502);
  }

  let datos;
  try {
    datos = await response.json();
  } catch {
    throw new ErrorConsultaDocumento('El proveedor devolvió una respuesta inválida', 502);
  }

  const nombre = tipoDocumento === 'DNI'
    ? datos.full_name || [datos.first_name, datos.first_last_name, datos.second_last_name].filter(Boolean).join(' ')
    : datos.razon_social;
  const documentoRespuesta = String(datos.document_number || datos.numero_documento || '').replace(/\D/g, '');
  if (typeof nombre !== 'string' || !nombre.trim() || documentoRespuesta !== documento) {
    throw new ErrorConsultaDocumento('La respuesta del proveedor no coincide con el documento consultado', 502);
  }

  return {
    tipo_documento: tipoDocumento,
    documento,
    nombre: nombre.trim(),
    direccion: typeof datos.direccion === 'string' ? datos.direccion.trim() : '',
  };
}

module.exports = { ErrorConsultaDocumento, consultarDocumento };