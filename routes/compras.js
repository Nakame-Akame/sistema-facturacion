const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const router = express.Router();
const db = require('../database');
const { requierePermiso } = require('../middleware/permisos');

const directorio = path.resolve(__dirname, '..', 'uploads', 'compras');
fs.mkdirSync(directorio, { recursive: true });
const almacenamiento = multer.diskStorage({
  destination: directorio,
  filename: (_req, file, callback) => {
    callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const cargarArchivo = multer({
  storage: almacenamiento,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const permitidos = ['application/pdf', 'image/jpeg', 'image/png'];
    callback(null, permitidos.includes(file.mimetype));
  },
});

router.get('/', requierePermiso('compras:ver'), (_req, res) => {
  const documentos = db.prepare('SELECT * FROM documentos_compra ORDER BY created_at DESC, id DESC').all();
  res.json({ ok: true, data: documentos });
});

router.post('/', requierePermiso('compras:crear'), cargarArchivo.fields([
  { name: 'archivo_factura', maxCount: 1 },
  { name: 'archivo_guia', maxCount: 1 },
]), (req, res) => {
  try {
    const body = req.body || {};
    const factura = req.files?.archivo_factura?.[0];
    const guia = req.files?.archivo_guia?.[0];
    if (!['factura', 'guia'].includes(body.tipo)) return res.status(400).json({ ok: false, error: 'Tipo de documento inválido' });
    if (!String(body.proveedor_documento || '').trim() || !String(body.proveedor_razon_social || '').trim()) {
      return res.status(400).json({ ok: false, error: 'El proveedor y su número de documento son obligatorios' });
    }
    const result = db.prepare(`
      INSERT INTO documentos_compra
        (tipo, orden_compra, serie, numero, condicion_pago, plazo_pago, fecha_factura,
         fecha_ingreso, fecha_pago, porcentaje, estado, proveedor_documento,
        proveedor_razon_social, proveedor_direccion, moneda, tipo_cambio,
        archivo_nombre, archivo_ruta, archivo_mime,
        factura_archivo_nombre, factura_archivo_ruta, factura_archivo_mime,
        guia_archivo_nombre, guia_archivo_ruta, guia_archivo_mime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      body.tipo,
      body.orden_compra || null,
      body.serie || null,
      body.numero || null,
      body.condicion_pago || null,
      body.plazo_pago || null,
      body.fecha_factura || null,
      body.fecha_ingreso || null,
      body.fecha_pago || null,
      body.porcentaje ? Number(body.porcentaje) : null,
      body.estado || 'pendiente',
      String(body.proveedor_documento).trim(),
      String(body.proveedor_razon_social).trim(),
      body.proveedor_direccion || null,
      body.moneda || 'PEN',
      body.tipo_cambio ? Number(body.tipo_cambio) : null,
      null,
      null,
      null,
      factura?.originalname || null,
      factura?.filename || null,
      factura?.mimetype || null,
      guia?.originalname || null,
      guia?.filename || null,
      guia?.mimetype || null
    );
    res.status(201).json({ ok: true, id: result.lastInsertRowid, mensaje: 'Documento de compra guardado' });
  } catch (error) {
    for (const archivo of [...(req.files?.archivo_factura || []), ...(req.files?.archivo_guia || [])]) {
      if (archivo.path) fs.rmSync(archivo.path, { force: true });
    }
    res.status(500).json({ ok: false, error: 'No se pudo guardar el documento de compra' });
  }
});

router.get('/:id/archivo', requierePermiso('compras:ver'), (req, res) => {
  const campo = req.query.tipo === 'guia' ? 'guia' : 'factura';
  const documento = db.prepare(`SELECT ${campo}_archivo_ruta AS archivo_ruta, ${campo}_archivo_nombre AS archivo_nombre, ${campo}_archivo_mime AS archivo_mime FROM documentos_compra WHERE id = ?`).get(req.params.id);
  if (!documento?.archivo_ruta) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
  const archivo = path.join(directorio, documento.archivo_ruta);
  if (!fs.existsSync(archivo)) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
  res.type(documento.archivo_mime || 'application/octet-stream');
  res.download(archivo, documento.archivo_nombre || 'documento');
});

module.exports = router;