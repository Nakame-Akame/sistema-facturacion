require('dotenv').config();
const path = require('node:path');
const Database = require("better-sqlite3");
const configuredPath = process.env.DB_PATH || 'facturacion.db';
const databasePath = configuredPath === ':memory:'
  ? configuredPath
  : path.resolve(__dirname, configuredPath);
const db = new Database(databasePath);

db.exec(`
  -- Clientes
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    documento TEXT,
    tipo_documento TEXT DEFAULT 'DNI', -- DNI, RUC, CE
    direccion TEXT,
    email TEXT,
    telefono TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Productos
  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio REAL NOT NULL,
    precio_compra REAL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    categoria TEXT,
    unidad TEXT DEFAULT 'UND', -- UND, KG, LT, MT, etc.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Tabla principal de comprobantes (unifica todos los tipos)
  CREATE TABLE IF NOT EXISTS comprobantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Tipo de comprobante
    tipo TEXT NOT NULL,
    -- 'factura'        → Factura Electrónica     F001
    -- 'boleta'         → Boleta Electrónica       B001
    -- 'nota_pedido'    → Nota de Pedido           NP01
    -- 'guia_remision'  → Guía de Remisión         GR01
    -- 'cotizacion'     → Cotización               COT01
    -- 'nota_devolucion'→ Nota de Devolución       ND01
    -- 'nota_credito_f' → Nota de Crédito Factura  NCF01
    -- 'nota_credito_b' → Nota de Crédito Boleta   NCB01

    serie TEXT NOT NULL,
    numero INTEGER NOT NULL,
    cliente_id INTEGER NOT NULL,

    -- Condición de pago
    condicion_pago TEXT DEFAULT 'contado', -- no_afecta, contado, credito
    fecha_vencimiento DATETIME,            -- solo para crédito

    -- Referencia a otro comprobante (para notas de crédito y devolución)
    comprobante_ref_id INTEGER,
    motivo_ref TEXT, -- motivo de la nota de crédito o devolución

    -- Datos de guía de remisión
    direccion_partida TEXT,
    direccion_llegada TEXT,
    transportista TEXT,
    fecha_traslado DATETIME,

    -- Totales
    subtotal REAL DEFAULT 0,
    igv REAL DEFAULT 0,
    descuento REAL DEFAULT 0,
    total REAL DEFAULT 0,
    afecta_igv INTEGER DEFAULT 1, -- 0 = no afecta IGV
    precios_incluyen_igv INTEGER DEFAULT 0,

    -- Estado
    estado TEXT DEFAULT 'emitido',
    -- factura/boleta: emitido, pagado, anulado
    -- cotizacion: borrador, enviado, aprobado, rechazado
    -- nota_pedido: pendiente, atendido, anulado

    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (comprobante_ref_id) REFERENCES comprobantes(id)
  );

  -- Detalle de cada comprobante
  CREATE TABLE IF NOT EXISTS detalle_comprobante (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comprobante_id INTEGER NOT NULL,
    producto_id INTEGER,              -- puede ser null en guía de remisión
    descripcion_libre TEXT,           -- descripción manual si no hay producto
    cantidad REAL NOT NULL,
    unidad TEXT DEFAULT 'UND',
    precio_unitario REAL DEFAULT 0,
    descuento_item REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id)
  );

  -- Usuarios
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'vendedor',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Series por tipo de comprobante
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT UNIQUE NOT NULL,
    serie TEXT NOT NULL,
    ultimo_numero INTEGER DEFAULT 0
  );

  -- Documentos de compras recibidos
  CREATE TABLE IF NOT EXISTS documentos_compra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT NOT NULL,
    orden_compra TEXT,
    serie TEXT,
    numero TEXT,
    condicion_pago TEXT,
    plazo_pago TEXT,
    fecha_factura TEXT,
    fecha_ingreso TEXT,
    fecha_pago TEXT,
    porcentaje REAL,
    estado TEXT DEFAULT 'pendiente',
    proveedor_documento TEXT NOT NULL,
    proveedor_razon_social TEXT NOT NULL,
    proveedor_direccion TEXT,
    moneda TEXT DEFAULT 'PEN',
    tipo_cambio REAL,
    archivo_nombre TEXT,
    archivo_ruta TEXT,
    archivo_mime TEXT,
    factura_archivo_nombre TEXT,
    factura_archivo_ruta TEXT,
    factura_archivo_mime TEXT,
    guia_archivo_nombre TEXT,
    guia_archivo_ruta TEXT,
    guia_archivo_mime TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tipo_cambio_diario (
    fecha TEXT PRIMARY KEY,
    compra REAL NOT NULL,
    venta REAL NOT NULL,
    fuente TEXT NOT NULL,
    actualizado_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const columnasCompras = db.pragma('table_info(documentos_compra)');
for (const columna of [
  ['factura_archivo_nombre', 'TEXT'],
  ['factura_archivo_ruta', 'TEXT'],
  ['factura_archivo_mime', 'TEXT'],
  ['guia_archivo_nombre', 'TEXT'],
  ['guia_archivo_ruta', 'TEXT'],
  ['guia_archivo_mime', 'TEXT'],
]) {
  if (!columnasCompras.some(actual => actual.name === columna[0])) {
    db.exec(`ALTER TABLE documentos_compra ADD COLUMN ${columna[0]} ${columna[1]}`);
  }
}

const columnasClientes = db.pragma('table_info(clientes)');
if (!columnasClientes.some(columna => columna.name === 'tipo_documento')) {
  db.exec("ALTER TABLE clientes ADD COLUMN tipo_documento TEXT DEFAULT 'DNI'");
}

const columnasProductos = db.pragma('table_info(productos)');
if (!columnasProductos.some(columna => columna.name === 'unidad')) {
  db.exec("ALTER TABLE productos ADD COLUMN unidad TEXT DEFAULT 'UND'");
}
if (!columnasProductos.some(columna => columna.name === 'precio_rebaja')) {
  db.exec('ALTER TABLE productos ADD COLUMN precio_rebaja REAL NOT NULL DEFAULT 0');
}
if (!columnasProductos.some(columna => columna.name === 'precio_pase')) {
  db.exec('ALTER TABLE productos ADD COLUMN precio_pase REAL NOT NULL DEFAULT 0');
}
if (!columnasProductos.some(columna => columna.name === 'precio_compra')) {
  db.exec('ALTER TABLE productos ADD COLUMN precio_compra REAL NOT NULL DEFAULT 0');
}
db.exec(`
  UPDATE productos
  SET precio_rebaja = precio
  WHERE precio_rebaja <= 0;
  UPDATE productos
  SET precio_pase = precio
  WHERE precio_pase <= 0;
`);

const columnasDetalle = db.pragma('table_info(detalle_comprobante)');
if (!columnasDetalle.some(columna => columna.name === 'tipo_precio')) {
  db.exec("ALTER TABLE detalle_comprobante ADD COLUMN tipo_precio TEXT NOT NULL DEFAULT 'unidad'");
}

const columnasComprobantes = db.pragma('table_info(comprobantes)');
if (!columnasComprobantes.some(columna => columna.name === 'precios_incluyen_igv')) {
  db.exec('ALTER TABLE comprobantes ADD COLUMN precios_incluyen_igv INTEGER NOT NULL DEFAULT 0');
}

// Insertar series por defecto si no existen
const seriesDefault = [
  { tipo: "factura", serie: "F001" },
  { tipo: "boleta", serie: "B001" },
  { tipo: "nota_pedido", serie: "NP01" },
  { tipo: "guia_remision", serie: "GR01" },
  { tipo: "cotizacion", serie: "COT1" },
  { tipo: "nota_devolucion", serie: "ND01" },
  { tipo: "nota_credito_f", serie: "NCF1" },
  { tipo: "nota_credito_b", serie: "NCB1" },
];

const insertSerie = db.prepare(`
  INSERT OR IGNORE INTO series (tipo, serie, ultimo_numero) VALUES (?, ?, 0)
`);
seriesDefault.forEach((s) => insertSerie.run(s.tipo, s.serie));

module.exports = db;
