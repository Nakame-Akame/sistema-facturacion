const express = require('express');
const router  = express.Router();
const db      = require('../database');
const htmlPdf = require('html-pdf-node');

const TIPOS_LABEL = {
  factura:         'Factura Electrónica',
  boleta:          'Boleta Electrónica',
  nota_pedido:     'Nota de Pedido',
  guia_remision:   'Guía de Remisión Electrónica',
  cotizacion:      'Cotización',
  nota_devolucion: 'Nota de Devolución',
  nota_credito_f:  'Nota de Crédito (Factura)',
  nota_credito_b:  'Nota de Crédito (Boleta)',
};

const CONDICION_LABEL = {
  no_afecta: 'No afecta',
  contado:   'Contado',
  credito:   'Crédito',
};

router.get('/:id', async (req, res) => {
  try {
    const comp = db.prepare(`
      SELECT c.*, cl.nombre as cliente_nombre, cl.documento as cliente_documento,
             cl.tipo_documento, cl.direccion as cliente_direccion,
             cl.email as cliente_email, cl.telefono as cliente_telefono,
             cr.serie as ref_serie, cr.numero as ref_numero, cr.tipo as ref_tipo
      FROM comprobantes c
      JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN comprobantes cr ON c.comprobante_ref_id = cr.id
      WHERE c.id = ?
    `).get(req.params.id);

    if (!comp) return res.status(404).json({ ok: false, error: 'Comprobante no encontrado' });

    const detalle = db.prepare(`
      SELECT d.*, p.nombre as producto_nombre
      FROM detalle_comprobante d
      LEFT JOIN productos p ON d.producto_id = p.id
      WHERE d.comprobante_id = ?
    `).all(req.params.id);

    const num    = `${comp.serie}-${String(comp.numero).padStart(6, '0')}`;
    const label  = TIPOS_LABEL[comp.tipo] || comp.tipo;
    const fecha  = new Date(comp.fecha).toLocaleDateString('es-PE', { year:'numeric', month:'long', day:'numeric' });
    const aplicaIgv = comp.igv && comp.igv > 0;

    // Estado
    const estadoColor = { emitido:'#2563eb', pagado:'#1a9974', anulado:'#d63660', borrador:'#a87c00', pendiente:'#a87c00', atendido:'#1a9974', aprobado:'#1a9974', rechazado:'#d63660' };
    const estadoBg    = { emitido:'#e8f0ff', pagado:'#e6f9f4', anulado:'#fde8ee', borrador:'#fff7e0', pendiente:'#fff7e0', atendido:'#e6f9f4', aprobado:'#e6f9f4', rechazado:'#fde8ee' };
    const ec = { fg: estadoColor[comp.estado] || '#2563eb', bg: estadoBg[comp.estado] || '#e8f0ff' };

    // Bloque condición de pago
    const condicionHtml = `
      <div style="margin-bottom:12px;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#888;font-weight:700;margin-bottom:4px;">Condición de pago</div>
        <div style="font-weight:600;">${CONDICION_LABEL[comp.condicion_pago] || comp.condicion_pago}</div>
        ${comp.condicion_pago === 'credito' && comp.fecha_vencimiento
          ? `<div style="color:#555;font-size:12px;">Vence: ${new Date(comp.fecha_vencimiento).toLocaleDateString('es-PE')}</div>`
          : ''}
      </div>`;

    // Bloque referencia (notas de crédito / devolución)
    let referenciaHtml = '';
    if (comp.comprobante_ref_id && comp.ref_tipo) {
      const refLabel = TIPOS_LABEL[comp.ref_tipo] || comp.ref_tipo;
      const refNum   = `${comp.ref_serie}-${String(comp.ref_numero).padStart(6,'0')}`;
      referenciaHtml = `
        <div style="background:#f8f9ff;border:1px solid #e0e8ff;border-radius:8px;padding:12px;margin-bottom:14px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#888;font-weight:700;margin-bottom:4px;">Comprobante referenciado</div>
          <div style="font-weight:600;">${refLabel} ${refNum}</div>
          ${comp.motivo_ref ? `<div style="color:#555;font-size:12px;margin-top:2px;">Motivo: ${comp.motivo_ref}</div>` : ''}
        </div>`;
    }

    // Bloque guía de remisión
    let guiaHtml = '';
    if (comp.tipo === 'guia_remision') {
      guiaHtml = `
        <div style="background:#f8f9ff;border:1px solid #e0e8ff;border-radius:8px;padding:12px;margin-bottom:14px;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#888;font-weight:700;margin-bottom:6px;">Datos del traslado</div>
          <div style="line-height:1.8;color:#333;">
            ${comp.direccion_partida ? `<strong>Partida:</strong> ${comp.direccion_partida}<br>` : ''}
            ${comp.direccion_llegada ? `<strong>Llegada:</strong> ${comp.direccion_llegada}<br>` : ''}
            ${comp.transportista     ? `<strong>Transportista:</strong> ${comp.transportista}<br>` : ''}
            ${comp.fecha_traslado    ? `<strong>Fecha:</strong> ${new Date(comp.fecha_traslado).toLocaleDateString('es-PE')}` : ''}
          </div>
        </div>`;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <style>
        * { box-sizing:border-box; margin:0; padding:0; }
        body { font-family: Arial, sans-serif; font-size:13px; color:#111; padding:40px; }
        .header { display:flex; justify-content:space-between; margin-bottom:24px; padding-bottom:16px; border-bottom:3px solid #1a1a2e; }
        .logo { font-size:22px; font-weight:900; color:#1a1a2e; }
        .logo .tipo { display:block; font-size:12px; color:#4f8ef7; font-weight:700; margin-top:4px; letter-spacing:0.3px; }
        .logo small { display:block; font-size:10px; color:#888; font-weight:400; margin-top:2px; }
        .num { text-align:right; }
        .num .serie { font-size:18px; font-weight:700; color:#4f8ef7; font-family:monospace; }
        .num .fecha { font-size:11px; color:#666; margin-top:4px; }
        .estado { display:inline-block; margin-top:8px; padding:3px 12px; border-radius:20px; font-size:11px; font-weight:700; }
        .cliente-bloque { margin-bottom:16px; }
        .label-sec { font-size:10px; text-transform:uppercase; letter-spacing:0.8px; color:#888; font-weight:700; margin-bottom:4px; }
        .cliente-nombre { font-size:15px; font-weight:700; }
        .cliente-info { color:#555; line-height:1.7; font-size:12px; }
        table { width:100%; border-collapse:collapse; margin:16px 0; }
        thead { background:#1a1a2e; color:#fff; }
        th { padding:9px 12px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; }
        td { padding:9px 12px; border-bottom:1px solid #eee; font-size:12px; }
        tr:last-child td { border-bottom:none; }
        tr:nth-child(even) td { background:#f8f9ff; }
        .totales { margin-left:auto; width:260px; margin-top:8px; }
        .tot-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #eee; }
        .tot-row.final { font-size:16px; font-weight:900; color:#1a1a2e; border-bottom:none; border-top:3px solid #1a1a2e; margin-top:4px; padding-top:8px; }
        .footer { margin-top:32px; padding-top:14px; border-top:1px solid #eee; text-align:center; font-size:11px; color:#aaa; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="logo">
            ⚡ FacturaPro
            <span class="tipo">${label}</span>
            <small>Sistema de Facturación</small>
          </div>
        </div>
        <div class="num">
          <div class="serie">${num}</div>
          <div class="fecha">${fecha}</div>
          <span class="estado" style="background:${ec.bg};color:${ec.fg};">${comp.estado.toUpperCase()}</span>
        </div>
      </div>

      <div class="cliente-bloque">
        <div class="label-sec">Cliente</div>
        <div class="cliente-nombre">${comp.cliente_nombre}</div>
        <div class="cliente-info">
          ${comp.cliente_documento ? `${comp.tipo_documento || 'Doc'}: ${comp.cliente_documento}<br>` : ''}
          ${comp.cliente_direccion ? `${comp.cliente_direccion}<br>` : ''}
          ${comp.cliente_email     ? `${comp.cliente_email}<br>` : ''}
          ${comp.cliente_telefono  ? `Tel: ${comp.cliente_telefono}` : ''}
        </div>
      </div>

      ${condicionHtml}
      ${referenciaHtml}
      ${guiaHtml}

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Descripción</th>
            <th>Cant.</th>
            <th style="text-align:right">P. Unit.</th>
            <th style="text-align:right">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${detalle.map((d, i) => `
            <tr>
              <td style="color:#888">${i + 1}</td>
              <td><strong>${d.producto_nombre || d.descripcion_libre || '—'}</strong></td>
              <td>${d.cantidad} ${d.unidad && d.unidad !== 'UND' ? d.unidad : ''}</td>
              <td style="text-align:right">S/ ${d.precio_unitario.toFixed(2)}</td>
              <td style="text-align:right"><strong>S/ ${d.subtotal.toFixed(2)}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>

      <div class="totales">
        <div class="tot-row"><span style="color:#666">Subtotal</span><span>S/ ${comp.subtotal.toFixed(2)}</span></div>
        ${comp.descuento > 0 ? `<div class="tot-row"><span style="color:#666">Descuento</span><span>- S/ ${comp.descuento.toFixed(2)}</span></div>` : ''}
        ${aplicaIgv ? `<div class="tot-row"><span style="color:#666">IGV (18%)</span><span>S/ ${comp.igv.toFixed(2)}</span></div>` : ''}
        <div class="tot-row final"><span>TOTAL</span><span>S/ ${comp.total.toFixed(2)}</span></div>
      </div>

      <div class="footer">
        Documento generado por FacturaPro &nbsp;|&nbsp; ${fecha} &nbsp;|&nbsp; Gracias por su preferencia
      </div>
    </body>
    </html>`;

    const pdfBuffer = await htmlPdf.generatePdf({ content: html }, {
      format: 'A4',
      margin: { top:'10mm', bottom:'10mm', left:'10mm', right:'10mm' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${num}.pdf"`);
    res.send(pdfBuffer);

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;