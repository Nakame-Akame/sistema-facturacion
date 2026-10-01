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

  CREATE TABLE IF NOT EXISTS pagos_comprobante (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comprobante_id INTEGER NOT NULL,
    monto REAL NOT NULL CHECK (monto > 0),
    fecha_pago TEXT NOT NULL,
    metodo_pago TEXT NOT NULL,
    referencia TEXT,
    usuario_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (comprobante_id) REFERENCES comprobantes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  -- Usuarios
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    rol TEXT DEFAULT 'vendedor',
    permisos TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Series por tipo de comprobante
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT UNIQUE NOT NULL,
    serie TEXT NOT NULL,
    ultimo_numero INTEGER DEFAULT 0
  );

  -- Almacenes y movimiento de inventario
  CREATE TABLE IF NOT EXISTS almacenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    codigo TEXT NOT NULL UNIQUE,
    tipo TEXT DEFAULT 'principal',
    activo INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS kardex_movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL,
    almacen_id INTEGER NOT NULL,
    tipo TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    costo_unitario REAL DEFAULT 0,
    stock_anterior INTEGER NOT NULL,
    stock_posterior INTEGER NOT NULL,
    documento_relacionado TEXT,
    observacion TEXT,
    usuario_id INTEGER,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (almacen_id) REFERENCES almacenes(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
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

  CREATE TABLE IF NOT EXISTS detalle_documento_compra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_compra_id INTEGER NOT NULL,
    producto_id INTEGER NOT NULL,
    cantidad INTEGER NOT NULL,
    costo_unitario REAL NOT NULL DEFAULT 0,
    almacen_id INTEGER NOT NULL,
    FOREIGN KEY (documento_compra_id) REFERENCES documentos_compra(id),
    FOREIGN KEY (producto_id) REFERENCES productos(id),
    FOREIGN KEY (almacen_id) REFERENCES almacenes(id)
  );

  CREATE TABLE IF NOT EXISTS pagos_documento_compra (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento_compra_id INTEGER NOT NULL,
    monto REAL NOT NULL CHECK (monto > 0),
    fecha_pago TEXT NOT NULL,
    metodo_pago TEXT NOT NULL,
    referencia TEXT,
    usuario_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (documento_compra_id) REFERENCES documentos_compra(id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
  );

  CREATE TABLE IF NOT EXISTS proveedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    documento TEXT NOT NULL UNIQUE COLLATE NOCASE,
    razon_social TEXT NOT NULL,
    direccion TEXT,
    telefono TEXT,
    email TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
for (const [nombre, tipo, valorDefault] of [
  ['codigo_interno', 'TEXT', "''"],
  ['sku', 'TEXT', "''"],
  ['codigo_barras', 'TEXT', "''"],
  ['marca', 'TEXT', "''"],
  ['unidad_medida', 'TEXT', "'UND'"],
  ['stock_minimo', 'INTEGER', 0],
  ['stock_maximo', 'INTEGER', 0],
  ['imagen', 'TEXT', "''"],
  ['activo', 'INTEGER', 1],
  ['igv', 'INTEGER', 1],
  ['ubicacion', 'TEXT', "''"],
  ['proveedor_principal', 'TEXT', "''"],
]) {
  if (!columnasProductos.some(columna => columna.name === nombre)) {
    db.exec(`ALTER TABLE productos ADD COLUMN ${nombre} ${tipo} DEFAULT ${valorDefault}`);
  }
}
db.exec(`
  UPDATE productos
  SET precio_rebaja = precio
  WHERE precio_rebaja <= 0;
  UPDATE productos
  SET precio_pase = precio
  WHERE precio_pase <= 0;
  UPDATE productos
  SET unidad_medida = 'UND'
  WHERE unidad_medida IS NULL OR TRIM(unidad_medida) = '';
  UPDATE productos
  SET activo = 1
  WHERE activo IS NULL;
  UPDATE productos
  SET igv = 1
  WHERE igv IS NULL;
`);

const columnasDetalle = db.pragma('table_info(detalle_comprobante)');
if (!columnasDetalle.some(columna => columna.name === 'tipo_precio')) {
  db.exec("ALTER TABLE detalle_comprobante ADD COLUMN tipo_precio TEXT NOT NULL DEFAULT 'unidad'");
}

const columnasComprobantes = db.pragma('table_info(comprobantes)');
if (!columnasComprobantes.some(columna => columna.name === 'precios_incluyen_igv')) {
  db.exec('ALTER TABLE comprobantes ADD COLUMN precios_incluyen_igv INTEGER NOT NULL DEFAULT 0');
}
if (!columnasComprobantes.some(columna => columna.name === 'fecha_pago')) {
  db.exec('ALTER TABLE comprobantes ADD COLUMN fecha_pago TEXT');
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
