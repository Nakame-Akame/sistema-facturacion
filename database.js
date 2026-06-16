const Database = require("better-sqlite3");
const db = new Database("facturacion.db");

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
    rol TEXT DEFAULT 'vendedor'
  );

  -- Series por tipo de comprobante
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo TEXT UNIQUE NOT NULL,
    serie TEXT NOT NULL,
    ultimo_numero INTEGER DEFAULT 0
  );
`);

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
