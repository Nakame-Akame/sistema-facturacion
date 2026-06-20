const API = 'http://localhost:3000/api';

// Helper: todas las llamadas a la API deben enviar la cookie de sesión
function apiFetch(url, options = {}) {
  return fetch(url, { ...options, credentials: 'include' });
}

let facturasData = [];
let clientesData = [];
let productosData = [];
let itemsFactura = [];
let facturaIdActual = null;

// ===== NAVEGACIÓN =====
function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.getAttribute('onclick') === `goTo('${page}')`) n.classList.add('active');
  });
  const titles = { dashboard: 'Dashboard', facturas: 'Comprobantes', clientes: 'Clientes', productos: 'Productos', reportes: 'Reportes' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'dashboard') cargarDashboard();
  if (page === 'facturas') cargarFacturas();
  if (page === 'clientes') cargarClientes();
  if (page === 'productos') cargarProductos();
  if (page === 'reportes') cargarReportes();
}

// ===== TOAST =====
function toast(msg, tipo = 'success') {
  const t = document.getElementById('toast');
  t.textContent = (tipo === 'success' ? '✓ ' : '✕ ') + msg;
  t.className = 'show ' + tipo;
  setTimeout(() => t.className = '', 3000);
}

// ===== MODAL =====
function cerrarModal(id) { document.getElementById(id).classList.remove('open'); }
function abrirModal(id) { document.getElementById(id).classList.add('open'); }

// ===== FECHA =====
document.getElementById('fecha-top').textContent = new Date().toLocaleDateString('es-PE', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

// ===== DASHBOARD =====
async function cargarDashboard() {
  try {
    const r = await apiFetch(`${API}/reportes/resumen`);
    const d = await r.json();
    if (!d.ok) return;
    const { ventas_hoy, ventas_mes, clientes, productos, facturas, productos_stock_bajo } = d.data;
    document.getElementById('stat-hoy').textContent = 'S/ ' + ventas_hoy.toFixed(2);
    document.getElementById('stat-mes').textContent = 'S/ ' + ventas_mes.toFixed(2);
    document.getElementById('stat-clientes').textContent = clientes;
    document.getElementById('stat-productos').textContent = productos;
    document.getElementById('stat-facturas').textContent = facturas;
    document.getElementById('stat-stock').textContent = productos_stock_bajo;

    const rTop = await apiFetch(`${API}/reportes/productos-mas-vendidos`);
    const dTop = await rTop.json();
    const tbody = document.getElementById('top-productos-body');
    if (dTop.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin ventas aún</p></div></td></tr>';
    } else {
      tbody.innerHTML = dTop.data.map(p => `
        <tr>
          <td>${p.nombre}</td>
          <td><span class="badge badge-blue">${p.unidades_vendidas}</span></td>
          <td class="mono">S/ ${p.ingresos_generados.toFixed(2)}</td>
        </tr>`).join('');
    }

    const rCli = await apiFetch(`${API}/reportes/mejores-clientes`);
    const dCli = await rCli.json();
    const tcli = document.getElementById('top-clientes-body');
    if (dCli.data.length === 0) {
      tcli.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin datos aún</p></div></td></tr>';
    } else {
      tcli.innerHTML = dCli.data.map(c => `
        <tr>
          <td>${c.nombre}</td>
          <td><span class="badge badge-green">${c.total_facturas}</span></td>
          <td class="mono">S/ ${c.total_compras.toFixed(2)}</td>
        </tr>`).join('');
    }
  } catch(e) { toast('Error conectando con el servidor', 'error'); }
}

// ===== CLIENTES =====
async function cargarClientes() {
  const r = await apiFetch(`${API}/clientes`);
  const d = await r.json();
  clientesData = d.data || [];
  renderClientes(clientesData);
}

function renderClientes(lista) {
  const tbody = document.getElementById('clientes-body');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty"><span class="icon">👥</span><p>No hay clientes aún</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(c => `
    <tr>
      <td><strong>${c.nombre}</strong></td>
      <td class="mono">${c.documento || '—'}</td>
      <td>${c.email || '—'}</td>
      <td>${c.telefono || '—'}</td>
      <td>
        <div class="actions-group">
          <button class="btn btn-ghost btn-sm" onclick="editarCliente(${c.id})">✏️ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="eliminarCliente(${c.id}, '${c.nombre}')">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

function filtrarClientes() {
  const q = document.getElementById('buscar-cliente').value.toLowerCase();
  renderClientes(clientesData.filter(c => c.nombre.toLowerCase().includes(q) || (c.documento||'').includes(q)));
}

function abrirModalCliente(id = null) {
  document.getElementById('cliente-id').value = '';
  document.getElementById('cliente-nombre').value = '';
  document.getElementById('cliente-doc').value = '';
  document.getElementById('cliente-tel').value = '';
  document.getElementById('cliente-email').value = '';
  document.getElementById('cliente-dir').value = '';
  document.getElementById('modal-cliente-title').textContent = 'Nuevo Cliente';
  abrirModal('modal-cliente');
}

async function editarCliente(id) {
  const r = await apiFetch(`${API}/clientes/${id}`);
  const d = await r.json();
  const c = d.data;
  document.getElementById('cliente-id').value = c.id;
  document.getElementById('cliente-nombre').value = c.nombre;
  document.getElementById('cliente-doc').value = c.documento || '';
  document.getElementById('cliente-tel').value = c.telefono || '';
  document.getElementById('cliente-email').value = c.email || '';
  document.getElementById('cliente-dir').value = c.direccion || '';
  document.getElementById('modal-cliente-title').textContent = 'Editar Cliente';
  abrirModal('modal-cliente');
}

async function guardarCliente() {
  const id = document.getElementById('cliente-id').value;
  const body = {
    nombre: document.getElementById('cliente-nombre').value,
    documento: document.getElementById('cliente-doc').value,
    telefono: document.getElementById('cliente-tel').value,
    email: document.getElementById('cliente-email').value,
    direccion: document.getElementById('cliente-dir').value,
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  const url = id ? `${API}/clientes/${id}` : `${API}/clientes`;
  const method = id ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { toast(id ? 'Cliente actualizado' : 'Cliente creado'); cerrarModal('modal-cliente'); cargarClientes(); }
  else toast(d.error, 'error');
}

async function eliminarCliente(id, nombre) {
  if (!confirm(`¿Eliminar a "${nombre}"?`)) return;
  const r = await apiFetch(`${API}/clientes/${id}`, { method: 'DELETE' });
  const d = await r.json();
  if (d.ok) { toast('Cliente eliminado'); cargarClientes(); }
  else toast(d.error, 'error');
}

// ===== PRODUCTOS =====
async function cargarProductos() {
  const r = await apiFetch(`${API}/productos`);
  const d = await r.json();
  productosData = d.data || [];
  renderProductos(productosData);
}

function renderProductos(lista) {
  const tbody = document.getElementById('productos-body');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty"><span class="icon">📦</span><p>No hay productos aún</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td><strong>${p.nombre}</strong><br><small style="color:var(--muted)">${p.descripcion||''}</small></td>
      <td>${p.categoria ? `<span class="badge badge-blue">${p.categoria}</span>` : '—'}</td>
      <td class="mono">S/ ${p.precio.toFixed(2)}</td>
      <td>${p.stock <= 5
        ? `<span class="badge badge-red">⚠️ ${p.stock}</span>`
        : `<span class="badge badge-green">${p.stock}</span>`}
      </td>
      <td>
        <div class="actions-group">
          <button class="btn btn-ghost btn-sm" onclick="editarProducto(${p.id})">✏️ Editar</button>
          <button class="btn btn-danger btn-sm" onclick="eliminarProducto(${p.id}, '${p.nombre}')">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

function filtrarProductos() {
  const q = document.getElementById('buscar-producto').value.toLowerCase();
  renderProductos(productosData.filter(p => p.nombre.toLowerCase().includes(q) || (p.categoria||'').toLowerCase().includes(q)));
}

function abrirModalProducto() {
  document.getElementById('producto-id').value = '';
  document.getElementById('producto-nombre').value = '';
  document.getElementById('producto-precio').value = '';
  document.getElementById('producto-stock').value = '';
  document.getElementById('producto-cat').value = '';
  document.getElementById('producto-desc').value = '';
  document.getElementById('modal-producto-title').textContent = 'Nuevo Producto';
  abrirModal('modal-producto');
}

async function editarProducto(id) {
  const r = await apiFetch(`${API}/productos/${id}`);
  const d = await r.json();
  const p = d.data;
  document.getElementById('producto-id').value = p.id;
  document.getElementById('producto-nombre').value = p.nombre;
  document.getElementById('producto-precio').value = p.precio;
  document.getElementById('producto-stock').value = p.stock;
  document.getElementById('producto-cat').value = p.categoria || '';
  document.getElementById('producto-desc').value = p.descripcion || '';
  document.getElementById('modal-producto-title').textContent = 'Editar Producto';
  abrirModal('modal-producto');
}

async function guardarProducto() {
  const id = document.getElementById('producto-id').value;
  const body = {
    nombre: document.getElementById('producto-nombre').value,
    precio: parseFloat(document.getElementById('producto-precio').value),
    stock: parseInt(document.getElementById('producto-stock').value) || 0,
    categoria: document.getElementById('producto-cat').value,
    descripcion: document.getElementById('producto-desc').value,
  };
  if (!body.nombre) return toast('El nombre es obligatorio', 'error');
  if (!body.precio || body.precio <= 0) return toast('El precio debe ser mayor a 0', 'error');
  const url = id ? `${API}/productos/${id}` : `${API}/productos`;
  const method = id ? 'PUT' : 'POST';
  const r = await apiFetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { toast(id ? 'Producto actualizado' : 'Producto creado'); cerrarModal('modal-producto'); cargarProductos(); }
  else toast(d.error, 'error');
}

async function eliminarProducto(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"?`)) return;
  const r = await apiFetch(`${API}/productos/${id}`, { method: 'DELETE' });
  const d = await r.json();
  if (d.ok) { toast('Producto eliminado'); cargarProductos(); }
  else toast(d.error, 'error');
}

// ===== FACTURAS =====
// ===== CONFIGURACIÓN DE TIPOS DE COMPROBANTE =====
const TIPOS_COMPROBANTE = {
  todos:           { label: 'Todos',                    color: '#7a86a0' },
  boleta:          { label: 'Boleta electrónica',        color: '#4f8ef7' },
  factura:         { label: 'Factura electrónica',       color: '#38d9a9' },
  nota_pedido:     { label: 'Nota de pedido',            color: '#f7c948' },
  guia_remision:   { label: 'Guía de remisión',          color: '#a78bfa' },
  cotizacion:      { label: 'Cotización',                color: '#7a86a0' },
  nota_devolucion: { label: 'Nota de devolución',        color: '#f06585' },
  nota_credito_f:  { label: 'Nota crédito (Factura)',    color: '#38d9a9' },
  nota_credito_b:  { label: 'Nota crédito (Boleta)',     color: '#4f8ef7' },
};
let tipoActivo = 'todos';

function toggleDropdownNuevo() {
  document.getElementById('dropdown-nuevo').classList.toggle('open');
}
// Cerrar el dropdown si se hace clic fuera
document.addEventListener('click', (e) => {
  const dd = document.getElementById('dropdown-nuevo');
  if (dd && !e.target.closest('.dropdown')) dd.classList.remove('open');
});

async function cargarFacturas() {
  const r = await apiFetch(`${API}/comprobantes`);
  const d = await r.json();
  facturasData = d.data || [];
  renderTabsComprobantes();
  aplicarFiltroTipo();
}

function renderTabsComprobantes() {
  const cont = document.getElementById('tabs-comprobantes');
  cont.innerHTML = Object.entries(TIPOS_COMPROBANTE).map(([key, cfg]) => {
    const count = key === 'todos' ? facturasData.length : facturasData.filter(f => f.tipo === key).length;
    return `<button class="tab-item ${tipoActivo === key ? 'active' : ''}" onclick="seleccionarTipo('${key}')">
      ${cfg.label} <span class="tab-count">${count}</span>
    </button>`;
  }).join('');
}

function seleccionarTipo(tipo) {
  tipoActivo = tipo;
  renderTabsComprobantes();
  aplicarFiltroTipo();
}

function aplicarFiltroTipo() {
  const q = (document.getElementById('buscar-factura').value || '').toLowerCase();
  let lista = tipoActivo === 'todos' ? facturasData : facturasData.filter(f => f.tipo === tipoActivo);
  if (q) lista = lista.filter(f => f.cliente_nombre.toLowerCase().includes(q));
  document.getElementById('comprobantes-titulo').textContent = tipoActivo === 'todos'
    ? 'Todos los comprobantes'
    : TIPOS_COMPROBANTE[tipoActivo].label + 's';
  renderFacturas(lista);
}

function renderFacturas(lista) {
  const tbody = document.getElementById('facturas-body');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><span class="icon">🧾</span><p>No hay comprobantes aún</p></div></td></tr>';
    return;
  }
  const condicionLabel = { no_afecta: 'No afecta', contado: 'Contado', credito: 'Crédito' };
  tbody.innerHTML = lista.map(f => {
    const estadoBadge = { emitido: 'badge-blue', pagado: 'badge-green', anulado: 'badge-red', borrador: 'badge-yellow', enviado: 'badge-blue', aprobado: 'badge-green', rechazado: 'badge-red', pendiente: 'badge-yellow', atendido: 'badge-green' };
    const cfg = TIPOS_COMPROBANTE[f.tipo] || { label: f.tipo, color: '#7a86a0' };
    const num = `${f.serie}-${String(f.numero).padStart(6,'0')}`;
    const fecha = new Date(f.fecha).toLocaleDateString('es-PE');
    const credVencido = f.condicion_pago === 'credito' && f.fecha_vencimiento && new Date(f.fecha_vencimiento) < new Date() && f.estado !== 'pagado';
    return `<tr>
      <td>
        <span class="mono">${num}</span><br>
        <small style="color:${cfg.color}">${cfg.label}</small>
      </td>
      <td><strong>${f.cliente_nombre}</strong><br><small style="color:var(--muted)">${f.cliente_documento||''}</small></td>
      <td>${fecha}</td>
      <td>
        <span class="badge ${f.condicion_pago === 'credito' ? (credVencido ? 'badge-red' : 'badge-yellow') : f.condicion_pago === 'contado' ? 'badge-green' : 'badge-blue'}">
          ${condicionLabel[f.condicion_pago] || f.condicion_pago}
        </span>
        ${f.condicion_pago === 'credito' && f.fecha_vencimiento ? `<br><small style="color:${credVencido?'var(--danger)':'var(--muted)'}">${credVencido?'⚠️ Venció: ':'Vence: '}${new Date(f.fecha_vencimiento).toLocaleDateString('es-PE')}</small>` : ''}
      </td>
      <td class="mono">S/ ${f.subtotal.toFixed(2)}</td>
      <td class="mono">S/ ${f.igv.toFixed(2)}</td>
      <td class="mono"><strong>S/ ${f.total.toFixed(2)}</strong></td>
      <td><span class="badge ${estadoBadge[f.estado]||'badge-blue'}">${f.estado}</span></td>
      <td>
        <div class="actions-group">
          <button class="btn btn-ghost btn-sm" onclick="verFactura(${f.id})">👁️ Ver</button>
          ${f.estado !== 'anulado' ? `
            ${f.estado === 'emitido' && (f.tipo === 'factura' || f.tipo === 'boleta') ? `<button class="btn btn-success btn-sm" onclick="cambiarEstado(${f.id},'pagado')">✓ Pagar</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="cambiarEstado(${f.id},'anulado')">✕</button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filtrarFacturas() {
  aplicarFiltroTipo();
}

// Config de qué campos mostrar según el tipo de comprobante
const CONFIG_TIPO = {
  boleta:          { afecta_igv: true,  necesita_ref: false, es_guia: false, condicion_default: 'contado' },
  factura:         { afecta_igv: true,  necesita_ref: false, es_guia: false, condicion_default: 'contado' },
  nota_pedido:     { afecta_igv: false, necesita_ref: false, es_guia: false, condicion_default: 'no_afecta' },
  guia_remision:   { afecta_igv: false, necesita_ref: false, es_guia: true,  condicion_default: 'no_afecta' },
  cotizacion:      { afecta_igv: false, necesita_ref: false, es_guia: false, condicion_default: 'no_afecta' },
  nota_devolucion: { afecta_igv: true,  necesita_ref: true,   es_guia: false, condicion_default: 'no_afecta' },
  nota_credito_f:  { afecta_igv: true,  necesita_ref: true,   es_guia: false, condicion_default: 'no_afecta' },
  nota_credito_b:  { afecta_igv: true,  necesita_ref: true,   es_guia: false, condicion_default: 'no_afecta' },
};

async function abrirModalFactura(tipoPreseleccionado) {
  document.getElementById('dropdown-nuevo').classList.remove('open');
  const tipo = tipoPreseleccionado || 'boleta';
  const cfg = CONFIG_TIPO[tipo];

  document.getElementById('factura-tipo').value = tipo;
  document.getElementById('modal-factura-title').textContent = 'Nuevo: ' + TIPOS_COMPROBANTE[tipo].label;
  document.getElementById('btn-emitir').textContent = '✓ Emitir ' + TIPOS_COMPROBANTE[tipo].label;

  itemsFactura = [];
  renderItems();

  // Condición de pago: preseleccionar según el tipo, pero el usuario puede cambiarla
  document.getElementById('factura-condicion').value = cfg.condicion_default;
  onCambioCondicionPago();

  // Mostrar/ocultar bloque de Guía de Remisión
  document.getElementById('campos-guia').style.display = cfg.es_guia ? 'block' : 'none';

  // Mostrar/ocultar bloque de referencia (notas de crédito / devolución)
  document.getElementById('campos-referencia').style.display = cfg.necesita_ref ? 'block' : 'none';
  document.getElementById('ref-motivo').value = '';

  // Cargar clientes
  const rc = await apiFetch(`${API}/clientes`);
  const dc = await rc.json();
  const selCli = document.getElementById('factura-cliente');
  selCli.innerHTML = '<option value="">-- Selecciona un cliente --</option>';
  (dc.data || []).forEach(c => {
    selCli.innerHTML += `<option value="${c.id}">${c.nombre} (${c.documento||'S/D'})</option>`;
  });

  // Cargar productos
  const rp = await apiFetch(`${API}/productos`);
  const dp = await rp.json();
  const selProd = document.getElementById('item-producto');
  selProd.innerHTML = '<option value="">-- Selecciona producto --</option>';
  (dp.data || []).forEach(p => {
    selProd.innerHTML += `<option value="${p.id}" data-precio="${p.precio}" data-stock="${p.stock}">${p.nombre} — S/ ${p.precio.toFixed(2)} (stock: ${p.stock})</option>`;
  });

  // Cargar comprobantes de referencia si aplica (facturas/boletas para vincular notas)
  if (cfg.necesita_ref) {
    const tipoRef = tipo === 'nota_credito_b' ? 'boleta' : tipo === 'nota_credito_f' ? 'factura' : null;
    const r = await apiFetch(`${API}/comprobantes${tipoRef ? '?tipo=' + tipoRef : ''}`);
    const d = await r.json();
    const selRef = document.getElementById('ref-comprobante');
    selRef.innerHTML = '<option value="">-- Selecciona comprobante --</option>';
    (d.data || []).filter(c => c.estado !== 'anulado').forEach(c => {
      const num = `${c.serie}-${String(c.numero).padStart(6,'0')}`;
      selRef.innerHTML += `<option value="${c.id}">${num} — ${c.cliente_nombre} (S/ ${c.total.toFixed(2)})</option>`;
    });
  }

  abrirModal('modal-factura');
}

function onCambioCondicionPago() {
  const condicion = document.getElementById('factura-condicion').value;
  document.getElementById('grupo-fecha-vencimiento').style.display = condicion === 'credito' ? 'block' : 'none';
}

function agregarItem() {
  const sel = document.getElementById('item-producto');
  const cantidad = parseInt(document.getElementById('item-cantidad').value);
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) return toast('Selecciona un producto', 'error');
  if (!cantidad || cantidad < 1) return toast('La cantidad debe ser mayor a 0', 'error');
  const tipo = document.getElementById('factura-tipo').value;
  const stock = parseInt(opt.dataset.stock);
  if (CONFIG_TIPO[tipo]?.es_guia === false && tipo !== 'nota_devolucion' && tipo !== 'cotizacion' && tipo !== 'nota_pedido' && cantidad > stock) {
    return toast(`Stock insuficiente. Disponible: ${stock}`, 'error');
  }
  const existe = itemsFactura.find(i => i.producto_id == sel.value);
  if (existe) { existe.cantidad += cantidad; existe.subtotal = existe.precio * existe.cantidad; }
  else {
    itemsFactura.push({ producto_id: sel.value, nombre: opt.text.split('—')[0].trim(), cantidad, precio: parseFloat(opt.dataset.precio), subtotal: parseFloat(opt.dataset.precio) * cantidad });
  }
  renderItems();
}

function quitarItem(idx) { itemsFactura.splice(idx, 1); renderItems(); }

function renderItems() {
  const lista = document.getElementById('items-lista');
  const totDiv = document.getElementById('items-total');
  lista.innerHTML = '<div class="item-row header"><span>Producto</span><span>Cant.</span><span>Subtotal</span><span></span></div>';
  if (itemsFactura.length === 0) { totDiv.style.display = 'none'; return; }
  itemsFactura.forEach((it, i) => {
    lista.innerHTML += `<div class="item-row">
      <span>${it.nombre}</span>
      <span class="mono">${it.cantidad}</span>
      <span class="mono">S/ ${it.subtotal.toFixed(2)}</span>
      <button class="btn btn-danger btn-sm" onclick="quitarItem(${i})">✕</button>
    </div>`;
  });

  const tipo = document.getElementById('factura-tipo').value;
  const condicion = document.getElementById('factura-condicion').value;
  const cfg = CONFIG_TIPO[tipo] || {};
  const aplicaIgv = cfg.afecta_igv && condicion !== 'no_afecta';

  const sub = itemsFactura.reduce((a,i) => a + i.subtotal, 0);
  const igv = aplicaIgv ? sub * 0.18 : 0;
  const total = sub + igv;

  document.getElementById('fila-igv').style.display = aplicaIgv ? 'flex' : 'none';
  document.getElementById('tot-sub').textContent = 'S/ ' + sub.toFixed(2);
  document.getElementById('tot-igv').textContent = 'S/ ' + igv.toFixed(2);
  document.getElementById('tot-total').textContent = 'S/ ' + total.toFixed(2);
  totDiv.style.display = 'block';
}

async function emitirFactura() {
  const tipo = document.getElementById('factura-tipo').value;
  const cliente_id = document.getElementById('factura-cliente').value;
  const condicion_pago = document.getElementById('factura-condicion').value;
  const cfg = CONFIG_TIPO[tipo] || {};

  if (!cliente_id) return toast('Selecciona un cliente', 'error');
  if (itemsFactura.length === 0) return toast('Agrega al menos un producto', 'error');

  let fecha_vencimiento = null;
  if (condicion_pago === 'credito') {
    fecha_vencimiento = document.getElementById('factura-vencimiento').value;
    if (!fecha_vencimiento) return toast('Indica la fecha de caducación del crédito', 'error');
  }

  const body = {
    tipo,
    cliente_id: parseInt(cliente_id),
    condicion_pago,
    fecha_vencimiento,
    items: itemsFactura.map(i => ({ producto_id: parseInt(i.producto_id), cantidad: i.cantidad })),
  };

  if (cfg.es_guia) {
    body.direccion_partida = document.getElementById('guia-partida').value;
    body.direccion_llegada = document.getElementById('guia-llegada').value;
    body.transportista     = document.getElementById('guia-transportista').value;
    body.fecha_traslado    = document.getElementById('guia-fecha-traslado').value;
  }

  if (cfg.necesita_ref) {
    const ref = document.getElementById('ref-comprobante').value;
    const motivo = document.getElementById('ref-motivo').value;
    if (!ref) return toast('Selecciona el comprobante que referencia', 'error');
    if (!motivo) return toast('Indica el motivo', 'error');
    body.comprobante_ref_id = parseInt(ref);
    body.motivo_ref = motivo;
  }

  const r = await apiFetch(`${API}/comprobantes`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json();
  if (d.ok) { toast(`${TIPOS_COMPROBANTE[tipo].label} ${d.numero} emitida por S/ ${d.total.toFixed(2)}`); cerrarModal('modal-factura'); cargarFacturas(); }
  else toast(d.error, 'error');
}

async function verFactura(id) {
  facturaIdActual = id;
  const r = await apiFetch(`${API}/comprobantes/${id}`);
  const d = await r.json();
  const f = d.data;
  const cfg = TIPOS_COMPROBANTE[f.tipo] || { label: f.tipo, color: '#4f8ef7' };
  const num = `${f.serie}-${String(f.numero).padStart(6,'0')}`;
  const fecha = new Date(f.fecha).toLocaleDateString('es-PE', { year:'numeric', month:'long', day:'numeric' });

  const estadoColores = {
    emitido:   { bg:'#e8f0ff', fg:'#2563eb' },
    pagado:    { bg:'#e6f9f4', fg:'#1a9974' },
    anulado:   { bg:'#fde8ee', fg:'#d63660' },
    borrador:  { bg:'#fff7e0', fg:'#a87c00' },
    enviado:   { bg:'#e8f0ff', fg:'#2563eb' },
    aprobado:  { bg:'#e6f9f4', fg:'#1a9974' },
    rechazado: { bg:'#fde8ee', fg:'#d63660' },
    pendiente: { bg:'#fff7e0', fg:'#a87c00' },
    atendido:  { bg:'#e6f9f4', fg:'#1a9974' },
  };
  const ec = estadoColores[f.estado] || estadoColores.emitido;

  const condicionLabel = { no_afecta: 'No afecta', contado: 'Contado', credito: 'Crédito' };

  // Bloque: condición de pago + vencimiento
  let condicionHtml = `
    <div class="fp-section">
      <div class="fp-label">Condición de pago</div>
      <div style="font-weight:600;">${condicionLabel[f.condicion_pago] || f.condicion_pago}</div>
      ${f.condicion_pago === 'credito' && f.fecha_vencimiento ? `<div style="color:#555;">Vence: ${new Date(f.fecha_vencimiento).toLocaleDateString('es-PE')}</div>` : ''}
    </div>`;

  // Bloque: referencia (notas de crédito / devolución)
  let referenciaHtml = '';
  if (f.comprobante_ref_id && f.ref_tipo) {
    const refCfg = TIPOS_COMPROBANTE[f.ref_tipo] || { label: f.ref_tipo };
    const refNum = `${f.ref_serie}-${String(f.ref_numero).padStart(6,'0')}`;
    referenciaHtml = `
      <div class="fp-section" style="background:#f8f9ff;padding:12px 14px;border-radius:8px;border:1px solid #e8edff;">
        <div class="fp-label">Comprobante referenciado</div>
        <div style="font-weight:600;">${refCfg.label} ${refNum}</div>
        ${f.motivo_ref ? `<div style="color:#555;margin-top:2px;">Motivo: ${f.motivo_ref}</div>` : ''}
      </div>`;
  }

  // Bloque: datos de traslado (guía de remisión)
  let guiaHtml = '';
  if (f.tipo === 'guia_remision') {
    guiaHtml = `
      <div class="fp-section" style="background:#f8f9ff;padding:12px 14px;border-radius:8px;border:1px solid #e8edff;">
        <div class="fp-label">Datos del traslado</div>
        <div style="color:#333;line-height:1.7;">
          ${f.direccion_partida ? `<strong>Partida:</strong> ${f.direccion_partida}<br>` : ''}
          ${f.direccion_llegada ? `<strong>Llegada:</strong> ${f.direccion_llegada}<br>` : ''}
          ${f.transportista ? `<strong>Transportista:</strong> ${f.transportista}<br>` : ''}
          ${f.fecha_traslado ? `<strong>Fecha de traslado:</strong> ${new Date(f.fecha_traslado).toLocaleDateString('es-PE')}` : ''}
        </div>
      </div>`;
  }

  const aplicaIgv = f.igv && f.igv > 0;

  document.getElementById('factura-preview-content').innerHTML = `
    <div class="factura-preview">
      <div class="fp-header">
        <div>
          <div class="fp-title">⚡ FacturaPro</div>
          <div style="font-size:11px;color:#888;margin-top:4px;">${cfg.label}</div>
        </div>
        <div style="text-align:right;">
          <div class="fp-num">${num}</div>
          <div style="font-size:12px;color:#888;">${fecha}</div>
          <div style="margin-top:6px;"><span style="background:${ec.bg};color:${ec.fg};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">${f.estado.toUpperCase()}</span></div>
        </div>
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:0 0 16px;">

      <div class="fp-section">
        <div class="fp-label">Cliente</div>
        <div style="font-weight:600;font-size:15px;">${f.cliente_nombre}</div>
        <div style="color:#555;">${f.cliente_documento ? 'RUC/DNI: ' + f.cliente_documento : ''}</div>
        <div style="color:#555;">${f.cliente_direccion || ''}</div>
        <div style="color:#555;">${f.cliente_email || ''}</div>
      </div>

      ${condicionHtml}
      ${referenciaHtml}
      ${guiaHtml}

      <table class="fp-table">
        <thead><tr><th>Producto</th><th>Cant.</th><th style="text-align:right;">P. Unit.</th><th style="text-align:right;">Subtotal</th></tr></thead>
        <tbody>
          ${f.detalle.map(d => `<tr>
            <td>${d.producto_nombre || d.descripcion_libre || '—'}</td>
            <td>${d.cantidad} ${d.unidad && d.unidad !== 'UND' ? d.unidad : ''}</td>
            <td style="text-align:right;">S/ ${d.precio_unitario.toFixed(2)}</td>
            <td style="text-align:right;">S/ ${d.subtotal.toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="fp-totals">
        <div class="fp-total-row"><span style="color:#888">Subtotal</span><span>S/ ${f.subtotal.toFixed(2)}</span></div>
        ${f.descuento > 0 ? `<div class="fp-total-row"><span style="color:#888">Descuento</span><span>- S/ ${f.descuento.toFixed(2)}</span></div>` : ''}
        ${aplicaIgv ? `<div class="fp-total-row"><span style="color:#888">IGV (18%)</span><span>S/ ${f.igv.toFixed(2)}</span></div>` : ''}
        <div class="fp-total-row final"><span>TOTAL</span><span>S/ ${f.total.toFixed(2)}</span></div>
      </div>

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center;">
        Generado por FacturaPro — Gracias por su preferencia
      </div>
    </div>`;
  abrirModal('modal-ver-factura');
}

async function cambiarEstado(id, estado) {
  const msgs = { pagado: '¿Marcar como pagado?', anulado: '¿Anular este comprobante? El stock será devuelto si aplica.' };
  if (!confirm(msgs[estado] || `¿Cambiar estado a ${estado}?`)) return;
  const r = await apiFetch(`${API}/comprobantes/${id}/estado`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ estado }) });
  const d = await r.json();
  if (d.ok) { toast(d.mensaje); cargarFacturas(); }
  else toast(d.error, 'error');
}

// ===== REPORTES =====
async function cargarReportes() {
  try {
    const r1 = await apiFetch(`${API}/reportes/igv-mes`);
    const d1 = await r1.json();
    if (d1.ok && d1.data) {
      document.getElementById('rep-subtotal').textContent = 'S/ ' + (d1.data.base_imponible||0).toFixed(2);
      document.getElementById('rep-igv').textContent = 'S/ ' + (d1.data.igv_total||0).toFixed(2);
      document.getElementById('rep-total').textContent = 'S/ ' + (d1.data.total_con_igv||0).toFixed(2);
    }

    const r2 = await apiFetch(`${API}/reportes/ventas-por-dia`);
    const d2 = await r2.json();
    const tdias = document.getElementById('rep-dias-body');
    if (d2.data.length === 0) { tdias.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin ventas aún</p></div></td></tr>'; }
    else { tdias.innerHTML = d2.data.map(v => `<tr><td class="mono">${v.dia}</td><td><span class="badge badge-blue">${v.cantidad_facturas}</span></td><td class="mono">S/ ${v.total.toFixed(2)}</td></tr>`).join(''); }

    const r3 = await apiFetch(`${API}/reportes/ventas-por-categoria`);
    const d3 = await r3.json();
    const tcat = document.getElementById('rep-cat-body');
    if (d3.data.length === 0) { tcat.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin datos</p></div></td></tr>'; }
    else { tcat.innerHTML = d3.data.map(c => `<tr><td><span class="badge badge-blue">${c.categoria}</span></td><td>${c.unidades_vendidas}</td><td class="mono">S/ ${c.ingresos.toFixed(2)}</td></tr>`).join(''); }

    const r4 = await apiFetch(`${API}/reportes/facturas-por-estado`);
    const d4 = await r4.json();
    const badgeMap = { emitida:'badge-blue', pagada:'badge-green', anulada:'badge-red' };
    const test = document.getElementById('rep-estados-body');
    if (d4.data.length === 0) { test.innerHTML = '<tr><td colspan="3"><div class="empty"><p>Sin datos</p></div></td></tr>'; }
    else { test.innerHTML = d4.data.map(e => `<tr><td><span class="badge ${badgeMap[e.estado]||'badge-blue'}">${e.estado}</span></td><td>${e.cantidad}</td><td class="mono">S/ ${(e.monto_total||0).toFixed(2)}</td></tr>`).join(''); }
  } catch(e) { toast('Error cargando reportes', 'error'); }
}

// ===== LOGIN / SESIÓN =====
async function verificarSesion() {
  try {
    const r = await apiFetch(`${API}/auth/me`);
    const d = await r.json();
    if (d.ok) {
      mostrarApp(d.usuario);
    } else {
      document.getElementById('login-screen').style.display = 'flex';
    }
  } catch (e) {
    document.getElementById('login-screen').style.display = 'flex';
  }
}

function mostrarApp(usuario) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  document.getElementById('user-pill').style.display = 'flex';
  document.getElementById('user-nombre').textContent = usuario.nombre;
  document.getElementById('user-rol').textContent = usuario.rol;
  document.getElementById('user-avatar').textContent = usuario.nombre.charAt(0).toUpperCase();
  cargarDashboard();
}

async function hacerLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errDiv = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errDiv.style.display = 'none';

  if (!email || !pass) {
    errDiv.textContent = 'Completa email y contraseña';
    errDiv.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="login-loader"></span> Ingresando...';

  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password: pass })
    });
    const d = await r.json();

    if (d.ok) {
      document.getElementById('login-pass').value = '';
      mostrarApp(d.usuario);
    } else {
      errDiv.textContent = d.error || 'No se pudo iniciar sesión';
      errDiv.style.display = 'block';
    }
  } catch (e) {
    errDiv.textContent = 'No se pudo conectar con el servidor';
    errDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Iniciar sesión';
  }
}

async function cerrarSesion() {
  await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('user-pill').style.display = 'none';
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-screen').style.display = 'flex';
}

// Verificar sesión al cargar la página
verificarSesion();