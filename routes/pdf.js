const express = require('express');
const router = express.Router();
const db = require('../database');
const htmlPdf = require('html-pdf-node');

// GET - Generar PDF de una factura
router.get('/:id', async (req, res) => {
  try {
    // Obtener datos de la factura
    const factura = db.prepare(`
      SELECT f.*, c.nombre as cliente_nombre, c.documento as cliente_documento,
             c.direccion as cliente_direccion, c.email as cliente_email,
             c.telefono as cliente_telefono
      FROM facturas f
      JOIN clientes c ON f.cliente_id = c.id
      WHERE f.id = ?
    `).get(req.params.id);

    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });

    const detalle = db.prepare(`
      SELECT df.*, p.nombre as producto_nombre
      FROM detalle_factura df
      JOIN productos p ON df.producto_id = p.id
      WHERE df.factura_id = ?
    `).all(req.params.id);

    const num = `F001-${String(factura.numero).padStart(6, '0')}`;
    const fecha = new Date(factura.fecha).toLocaleDateString('es-PE', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // HTML del PDF
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, sans-serif; font-size: 13px; color: #111; padding: 40px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #1a1a2e; }
        .logo { font-size: 24px; font-weight: 900; color: #1a1a2e; }
        .logo small { display: block; font-size: 11px; color: #888; font-weight: 400; margin-top: 4px; }
        .num { text-align: right; }
        .num .serie { font-size: 20px; font-weight: 700; color: #4f8ef7; font-family: monospace; }
        .num .fecha { font-size: 12px; color: #666; margin-top: 4px; }
        .estado { display: inline-block; margin-top: 8px; padding: 3px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; }
        .estado.emitida { background: #e8f0ff; color: #2563eb; }
        .estado.pagada { background: #e6f9f4; color: #1a9974; }
        .estado.anulada { background: #fde8ee; color: #d63660; }
        .section { margin-bottom: 20px; }
        .section-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: #888; font-weight: 700; margin-bottom: 6px; }
        .cliente-nombre { font-size: 16px; font-weight: 700; }
        .cliente-info { color: #555; line-height: 1.8; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        thead { background: #1a1a2e; color: #fff; }
        th { padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
        td { padding: 10px 12px; border-bottom: 1px solid #eee; }
        tr:last-child td { border-bottom: none; }
        tr:nth-child(even) td { background: #f8f9ff; }
        .totales { margin-left: auto; width: 260px; margin-top: 10px; }
        .tot-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; border-bottom: 1px solid #eee; }
        .tot-row.final { font-size: 17px; font-weight: 900; color: #1a1a2e; border-bottom: none; border-top: 3px solid #1a1a2e; margin-top: 4px; padding-top: 10px; }
        .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; text-align: center; font-size: 11px; color: #aaa; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="logo">⚡ FacturaPro<small>Sistema de Facturación</small></div>
        </div>
        <div class="num">
          <div class="serie">${num}</div>
          <div class="fecha">${fecha}</div>
          <span class="estado ${factura.estado}">${factura.estado.toUpperCase()}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-label">Datos del cliente</div>
        <div class="cliente-nombre">${factura.cliente_nombre}</div>
        <div class="cliente-info">
          ${factura.cliente_documento ? `RUC/DNI: ${factura.cliente_documento}<br>` : ''}
          ${factura.cliente_direccion ? `Dirección: ${factura.cliente_direccion}<br>` : ''}
          ${factura.cliente_email ? `Email: ${factura.cliente_email}<br>` : ''}
          ${factura.cliente_telefono ? `Teléfono: ${factura.cliente_telefono}` : ''}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Producto</th>
            <th style="text-align:center">Cant.</th>
            <th style="text-align:right">P. Unit.</th>
            <th style="text-align:right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${detalle.map((d, i) => `
            <tr>
              <td style="color:#888">${i + 1}</td>
              <td><strong>${d.producto_nombre}</strong></td>
              <td style="text-align:center">${d.cantidad}</td>
              <td style="text-align:right">S/ ${d.precio_unitario.toFixed(2)}</td>
              <td style="text-align:right"><strong>S/ ${d.subtotal.toFixed(2)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="totales">
        <div class="tot-row"><span style="color:#666">Subtotal (sin IGV)</span><span>S/ ${factura.subtotal.toFixed(2)}</span></div>
        <div class="tot-row"><span style="color:#666">IGV (18%)</span><span>S/ ${factura.igv.toFixed(2)}</span></div>
        <div class="tot-row final"><span>TOTAL A PAGAR</span><span>S/ ${factura.total.toFixed(2)}</span></div>
      </div>

      <div class="footer">
        Documento generado por FacturaPro &nbsp;|&nbsp; ${fecha} &nbsp;|&nbsp; Gracias por su preferencia
      </div>
    </body>
    </html>`;

    // Generar PDF
    const file = { content: html };
    const options = {
      format: 'A4',
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' }
    };

    const pdfBuffer = await htmlPdf.generatePdf(file, options);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${num}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;