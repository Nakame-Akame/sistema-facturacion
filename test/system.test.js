process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-only-session-secret';
process.env.LOGIN_RATE_LIMIT = '100';
process.env.DECOLECTA_API_TOKEN = 'test-decolecta-token';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { createAdmin } = require('../scripts/create-admin');
const app = require('../server');

let server;
let api;

test.before(async () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM usuarios WHERE email = 'admin@facturapro.com'").get().total, 0);
  await createAdmin({
    nombre: 'Administrador de prueba',
    email: 'admin@facturapro.com',
    password: 'PruebaAdmin-2026!Seguro',
  });
  assert.ok(db.prepare("SELECT created_at FROM usuarios WHERE email = 'admin@facturapro.com'").get().created_at);
  db.prepare('INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)')
    .run('Vendedor de prueba', 'vendedor@test.local', bcrypt.hashSync('VendedorSeguro-2026!Pass', 12), 'vendedor');
  db.prepare('INSERT INTO clientes (nombre, documento) VALUES (?, ?)')
    .run('Cliente de prueba', 'DOC-TEST');
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto de prueba', 100, 10);
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto con stock limitado', 50, 1);
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto fraccionario', 0.1, 3);
  db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)')
    .run('Producto con precio legado', 1.005, 1);

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  api = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  db.close();
});

async function login(email = 'admin@facturapro.com', password = 'PruebaAdmin-2026!Seguro') {
  const response = await fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const cookieHeader = response.headers.get('set-cookie');
  return {
    response,
    cookie: cookieHeader?.split(';')[0],
    cookieHeader,
  };
}

test('health endpoint responds successfully', async () => {
  const response = await fetch(`${api}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), { ok: true });
});

test('unknown API routes return a consistent JSON 404', async () => {
  const response = await fetch(`${api}/api/route-that-does-not-exist`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'Ruta no encontrada' });
});

test('malformed JSON returns a sanitized client error', async () => {
  const response = await fetch(`${api}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid-json',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'Solicitud inválida' });
});

test('login accepts valid credentials and rejects invalid credentials', async () => {
  const valid = await login();
  assert.equal(valid.response.status, 200);
  assert.ok(valid.cookie);

  assert.match(valid.cookieHeader, /HttpOnly/i);
  assert.match(valid.cookieHeader, /SameSite=Lax/i);
  const invalid = await login('admin@facturapro.com', 'incorrecta');
  assert.equal(invalid.response.status, 401);
});

test('creates a comprobante using server-calculated totals', async () => {
  const { cookie } = await login();
  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      items: [{ producto_id: 1, cantidad: 1, precio_unitario: 0.01 }],
      total: 1,
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.subtotal, 84.75);
  assert.equal(result.igv, 15.25);
  assert.equal(result.total, 100);

  const saved = db.prepare('SELECT total FROM comprobantes WHERE id = ?').get(result.id);
  assert.equal(saved.total, 100);
  const savedItem = db.prepare('SELECT precio_unitario FROM detalle_comprobante WHERE comprobante_id = ?').get(result.id);
  assert.equal(savedItem.precio_unitario, 100);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);

  const detailResponse = await fetch(`${api}/api/comprobantes/${result.id}`, {
    headers: { Cookie: cookie },
  });
  const detail = await detailResponse.json();
  assert.equal(detailResponse.status, 200);
  assert.equal(detail.data.id, result.id);
  assert.equal(detail.data.tipo_documento, 'DNI');
  assert.equal(detail.data.detalle.length, 1);

  const pdf = await fetch(`${api}/api/pdf/${result.id}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');

  for (const formato of ['80mm', '58mm']) {
    const ticket = await fetch(`${api}/api/pdf/${result.id}?formato=${formato}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(ticket.status, 200);
    assert.match(ticket.headers.get('content-type'), /application\/pdf/);
    assert.equal(Buffer.from(await ticket.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.match(ticket.headers.get('content-disposition'), new RegExp(`ticket-${formato}`));
  }
});

test('consults DNI and RUC through the authenticated server-side identity endpoint', async () => {
  const { cookie } = await login();
  const nativeFetch = global.fetch;
  const consultas = [];
  global.fetch = async (input, options) => {
    const url = String(input);
    if (!url.startsWith('https://api.decolecta.com/')) return nativeFetch(input, options);

    consultas.push({ url, authorization: options.headers.Authorization });
    const datos = url.includes('/reniec/')
      ? { full_name: 'ANA PEREZ', document_number: '12345678' }
      : { razon_social: 'EMPRESA DEMO SAC', numero_documento: '20123456789', direccion: 'LIMA' };
    return new Response(JSON.stringify(datos), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const dniResponse = await fetch(`${api}/api/clientes/consultar-documento/12.345.678`, {
      headers: { Cookie: cookie },
    });
    const dni = await dniResponse.json();
    assert.equal(dniResponse.status, 200);
    assert.deepEqual(dni.data, {
      tipo_documento: 'DNI',
      documento: '12345678',
      nombre: 'ANA PEREZ',
      direccion: '',
    });
    assert.equal(JSON.stringify(dni).includes('test-decolecta-token'), false);

    const rucResponse = await fetch(`${api}/api/clientes/consultar-documento/20123456789`, {
      headers: { Cookie: cookie },
    });
    const ruc = await rucResponse.json();
    assert.equal(rucResponse.status, 200);
    assert.equal(ruc.data.tipo_documento, 'RUC');
    assert.equal(consultas.length, 2);
    assert.match(consultas[0].url, /\/v1\/reniec\/dni\?numero=12345678$/);
    assert.match(consultas[1].url, /\/v1\/sunat\/ruc\?numero=20123456789$/);
    assert.equal(consultas[0].authorization, 'Bearer test-decolecta-token');
  } finally {
    global.fetch = nativeFetch;
  }
});

test('rejects a comprobante without items', async () => {
  const { cookie } = await login();
  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({ tipo: 'factura', cliente_id: 1, items: [] }),
  });
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.match(result.error, /ítem/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM comprobantes').get().total, 1);
});

test('rejects invalid quantities, excessive discounts, unknown products and bad dates atomically', async () => {
  const { cookie } = await login();
  const invalidRequests = [
    { items: [{ producto_id: 1, cantidad: 0 }] },
    { items: [{ producto_id: 1, cantidad: 0.0000001 }] },
    { items: [{ producto_id: 1, cantidad: -1 }] },
    { items: [{ producto_id: 1, cantidad: 1, descuento_item: 100.01 }] },
    { items: [{ producto_id: 1, cantidad: 1 }], descuento: 100.01 },
    { items: [{ producto_id: 999, cantidad: 1 }] },
    {
      items: [{ producto_id: 1, cantidad: 1 }],
      condicion_pago: 'credito',
      fecha_vencimiento: '2026-02-31',
    },
  ];

  for (const invalidRequest of invalidRequests) {
    const response = await fetch(`${api}/api/comprobantes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ tipo: 'factura', cliente_id: 1, ...invalidRequest }),
    });
    assert.ok([400, 404].includes(response.status), `unexpected status ${response.status}`);
  }

  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM comprobantes').get().total, 1);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);
  assert.equal(db.prepare("SELECT ultimo_numero FROM series WHERE tipo = 'factura'").get().ultimo_numero, 1);
});

test('caps returns to original sold quantity and reverses stock only once', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const invoice = db.prepare("SELECT id FROM comprobantes WHERE tipo = 'factura'").get();
  const returnBody = {
    tipo: 'nota_devolucion',
    cliente_id: 1,
    comprobante_ref_id: invoice.id,
    motivo_ref: 'Devolución de prueba',
    items: [{ producto_id: 1, cantidad: 1 }],
  };

  const excessiveReturn = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...returnBody, items: [{ producto_id: 1, cantidad: 2 }] }),
  });
  assert.equal(excessiveReturn.status, 400);

  const validReturn = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(returnBody),
  });
  const returned = await validReturn.json();
  assert.equal(validReturn.status, 201);
  assert.equal(returned.total, 100);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);

  const duplicateReturn = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify(returnBody),
  });
  assert.equal(duplicateReturn.status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);

  const cancelReturn = () => fetch(`${api}/api/comprobantes/${returned.id}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'anulado' }),
  });
  assert.equal((await cancelReturn()).status, 200);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);
  assert.equal((await cancelReturn()).status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 9);

  const cancelInvoice = () => fetch(`${api}/api/comprobantes/${invoice.id}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'anulado' }),
  });
  assert.equal((await cancelInvoice()).status, 200);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);
  assert.equal((await cancelInvoice()).status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);
});

test('manual stock adjustment validates quantity and never permits negative stock', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };

  const invalidQuantity = await fetch(`${api}/api/productos/1/stock`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ cantidad: 1.5, operacion: 'sumar' }),
  });
  assert.equal(invalidQuantity.status, 400);

  const insufficientStock = await fetch(`${api}/api/productos/1/stock`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ cantidad: 11, operacion: 'restar' }),
  });
  assert.equal(insufficientStock.status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);

  const invalidProductUpdate = await fetch(`${api}/api/productos/1`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ nombre: 'Producto de prueba', precio: 100, stock: -1 }),
  });
  assert.equal(invalidProductUpdate.status, 400);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 10);
});

test('partial refunds proration preserves the original total to the cent', async () => {
  const { cookie } = await login();
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const saleResponse = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      descuento: 0.01,
      items: [{ producto_id: 3, cantidad: 3 }],
    }),
  });
  const sale = await saleResponse.json();
  assert.equal(saleResponse.status, 201);
  assert.equal(sale.total, 0.29);

  const refundTotals = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await fetch(`${api}/api/comprobantes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tipo: 'nota_devolucion',
        cliente_id: 1,
        comprobante_ref_id: sale.id,
        motivo_ref: 'Devolución parcial de prueba',
        items: [{ producto_id: 3, cantidad: 1 }],
      }),
    });
    const refund = await response.json();
    assert.equal(response.status, 201);
    refundTotals.push(refund.total);
  }

  assert.deepEqual(refundTotals, [0.09, 0.09, 0.11]);
  assert.equal(Number(refundTotals.reduce((sum, amount) => sum + amount, 0).toFixed(2)), sale.total);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 3').get().stock, 3);
});

test('catalog prices with decimal fractions round half-up to cents', async () => {
  const { cookie } = await login();
  const createdProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ nombre: 'Precio redondeado', precio: 1.005, stock: 1 }),
  });
  const createdProductResult = await createdProduct.json();
  assert.equal(createdProduct.status, 201);
  assert.equal(db.prepare('SELECT precio FROM productos WHERE id = ?')
    .get(createdProductResult.id).precio, 1.01);

  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      items: [{ producto_id: 4, cantidad: 1 }],
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.subtotal, 0.86);
  assert.equal(result.igv, 0.15);
  assert.equal(result.total, 1.01);
});

test('sales use the selected product price type', async () => {
  const { cookie } = await login();
  const createdProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      nombre: 'Producto con precios por tipo',
      precio: 100,
      precio_rebaja: 80,
      precio_pase: 60,
      stock: 2,
    }),
  });
  const createdProductResult = await createdProduct.json();
  assert.equal(createdProduct.status, 201);

  const response = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'boleta',
      cliente_id: 1,
      items: [{ producto_id: createdProductResult.id, cantidad: 1, tipo_precio: 'rebaja' }],
    }),
  });
  const result = await response.json();
  const detalle = db.prepare('SELECT precio_unitario, tipo_precio FROM detalle_comprobante WHERE comprobante_id = ?')
    .get(result.id);

  assert.equal(response.status, 201);
  assert.equal(result.subtotal, 67.8);
  assert.equal(result.igv, 12.2);
  assert.equal(result.total, 80);
  assert.equal(detalle.precio_unitario, 80);
  assert.equal(detalle.tipo_precio, 'rebaja');
});

test('concurrent sales cannot consume the same stock or reserve duplicate numbers', async () => {
  const { cookie } = await login();
  const request = () => fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'factura',
      cliente_id: 1,
      items: [{ producto_id: 2, cantidad: 1 }],
    }),
  });

  const responses = await Promise.all([request(), request()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 400]);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 2').get().stock, 0);
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS total
    FROM detalle_comprobante
    WHERE producto_id = 2
  `).get().total, 1);
  assert.equal(db.prepare("SELECT ultimo_numero FROM series WHERE tipo = 'factura'").get().ultimo_numero, 4);
});

test('seller can perform allowed work but receives 403 for restricted actions', async () => {
  const { cookie } = await login('vendedor@test.local', 'VendedorSeguro-2026!Pass');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  const clients = await fetch(`${api}/api/clientes`, { headers });
  assert.equal(clients.status, 200);

  const reports = await fetch(`${api}/api/reportes/resumen`, { headers });
  assert.equal(reports.status, 200);

  const users = await fetch(`${api}/api/auth/usuarios`, { headers });
  assert.equal(users.status, 403);

  const adminSession = await login();
  const adminUsers = await fetch(`${api}/api/auth/usuarios`, {
    headers: { Cookie: adminSession.cookie },
  });
  assert.equal(adminUsers.status, 200);

  const createClient = await fetch(`${api}/api/clientes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: 'Cliente creado por vendedor',
      documento: '20123456789',
      tipo_documento: 'RUC',
    }),
  });
  assert.equal(createClient.status, 201);
  assert.equal(db.prepare('SELECT tipo_documento FROM clientes WHERE documento = ?').get('20123456789').tipo_documento, 'RUC');

  const createProduct = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ nombre: 'No autorizado', precio: 10 }),
  });
  assert.equal(createProduct.status, 403);

  const adjustStock = await fetch(`${api}/api/productos/1/stock`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ cantidad: 1, operacion: 'sumar' }),
  });
  assert.equal(adjustStock.status, 403);

  const invoiceId = db.prepare('SELECT id FROM comprobantes LIMIT 1').get().id;
  const cancelInvoice = await fetch(`${api}/api/comprobantes/${invoiceId}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'anulado' }),
  });
  assert.equal(cancelInvoice.status, 403);

  const refund = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tipo: 'nota_devolucion',
      cliente_id: 1,
      items: [{ producto_id: 1, cantidad: 1 }],
    }),
  });
  assert.equal(refund.status, 403);
});

test('generates a PDF for a long document with many product rows', async () => {
  const { cookie } = await login();
  const productResponse = await fetch(`${api}/api/productos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      nombre: 'Producto con una descripción extraordinariamente larga para verificar el salto de línea en impresión térmica',
      precio: 10,
      precio_rebaja: 9,
      precio_pase: 8,
      stock: 30,
    }),
  });
  const product = await productResponse.json();
  assert.equal(productResponse.status, 201);

  const saleResponse = await fetch(`${api}/api/comprobantes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      tipo: 'boleta',
      cliente_id: 1,
      items: Array.from({ length: 20 }, () => ({ producto_id: product.id, cantidad: 1 })),
    }),
  });
  const sale = await saleResponse.json();
  assert.equal(saleResponse.status, 201);

  const pdf = await fetch(`${api}/api/pdf/${sale.id}?formato=80mm`, { headers: { Cookie: cookie } });
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});