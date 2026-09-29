const assert = require('node:assert/strict');
const test = require('node:test');
const { ErrorConsultaDocumento, consultarDocumento } = require('../services/consulta-documento');

function respuesta(datos, status = 200) {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('consulta DNI en RENIEC y RUC en SUNAT con el token Bearer', async () => {
  const llamadas = [];
  const fetchImpl = async (url, options) => {
    llamadas.push({ url, options });
    return url.includes('/reniec/')
      ? respuesta({ full_name: 'ANA PEREZ', document_number: '12345678' })
      : respuesta({ razon_social: 'EMPRESA DEMO SAC', numero_documento: '20123456789', direccion: 'LIMA' });
  };

  const dni = await consultarDocumento('12.345.678', { token: 'token-de-prueba', fetchImpl });
  const ruc = await consultarDocumento('20-123-456789', { token: 'token-de-prueba', fetchImpl });

  assert.deepEqual(dni, {
    tipo_documento: 'DNI',
    documento: '12345678',
    nombre: 'ANA PEREZ',
    direccion: '',
  });
  assert.deepEqual(ruc, {
    tipo_documento: 'RUC',
    documento: '20123456789',
    nombre: 'EMPRESA DEMO SAC',
    direccion: 'LIMA',
  });
  assert.match(llamadas[0].url, /\/v1\/reniec\/dni\?numero=12345678$/);
  assert.match(llamadas[1].url, /\/v1\/sunat\/ruc\?numero=20123456789$/);
  assert.equal(llamadas[0].options.headers.Authorization, 'Bearer token-de-prueba');
});

test('rechaza documentos con longitud inválida antes de llamar al proveedor', async () => {
  let llamadas = 0;
  await assert.rejects(
    consultarDocumento('1234', { token: 'token-de-prueba', fetchImpl: async () => { llamadas += 1; } }),
    error => error instanceof ErrorConsultaDocumento && error.status === 400
  );
  assert.equal(llamadas, 0);
});

test('informa cuando no hay token configurado sin llamar al proveedor', async () => {
  let llamadas = 0;
  await assert.rejects(
    consultarDocumento('12345678', { token: '', fetchImpl: async () => { llamadas += 1; } }),
    error => error instanceof ErrorConsultaDocumento && error.status === 503
  );
  assert.equal(llamadas, 0);
});

test('rechaza una respuesta del proveedor que no coincide con el documento solicitado', async () => {
  await assert.rejects(
    consultarDocumento('12345678', {
      token: 'token-de-prueba',
      fetchImpl: async () => respuesta({ full_name: 'ANA PEREZ', document_number: '87654321' }),
    }),
    error => error instanceof ErrorConsultaDocumento && error.status === 502
  );
});
